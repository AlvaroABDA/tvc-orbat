/**
 * TVC-ORBAT // MÓDULO METOC (INFORME METEOROLÓGICO BAJO DEMANDA)
 * Sin peticiones constantes ni polling: consulta estrictamente cuando el usuario/equipo accede o refresca.
 */
(function () {
    'use strict';

    const DEFAULT_TVC_LAT = 41.959377;
    const DEFAULT_TVC_LNG = -6.259835;

    const WMO_MAP = {
        0:  ['Cielo despejado', 'sunny'],
        1:  ['Mayormente despejado', 'partly_cloudy_day'],
        2:  ['Parcialmente nuboso', 'partly_cloudy_day'],
        3:  ['Cielo cubierto', 'cloud'],
        45: ['Niebla en superficie', 'foggy'],
        48: ['Niebla engelante', 'foggy'],
        51: ['Llovizna débil', 'rainy'],
        53: ['Llovizna moderada', 'rainy'],
        55: ['Llovizna densa', 'rainy'],
        56: ['Llovizna helada', 'ac_unit'],
        57: ['Llovizna helada densa', 'ac_unit'],
        61: ['Lluvia débil', 'rainy'],
        63: ['Lluvia moderada', 'rainy'],
        65: ['Lluvia intensa', 'rainy'],
        66: ['Lluvia helada', 'ac_unit'],
        67: ['Lluvia helada fuerte', 'ac_unit'],
        71: ['Nevada débil', 'ac_unit'],
        73: ['Nevada moderada', 'ac_unit'],
        75: ['Nevada intensa', 'ac_unit'],
        77: ['Granos de nieve', 'ac_unit'],
        80: ['Chubascos débiles', 'rainy'],
        81: ['Chubascos moderados', 'rainy'],
        82: ['Chubascos violentos', 'thunderstorm'],
        85: ['Chubascos de nieve', 'ac_unit'],
        86: ['Chubascos de nieve fuertes', 'ac_unit'],
        95: ['Tormenta eléctrica', 'thunderstorm'],
        96: ['Tormenta con granizo', 'thunderstorm'],
        99: ['Tormenta severa con granizo', 'thunderstorm']
    };

    const instances = {};

    function escHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function degToCardinal(deg) {
        if (deg === null || deg === undefined || isNaN(deg)) return '--';
        const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
        return dirs[Math.round(((Number(deg) % 360) + 360) % 360 / 22.5) % 16];
    }

    function wmoMeta(code) {
        const entry = WMO_MAP[Number(code)] || ['Condición variable', 'cloud'];
        return { code: Number(code || 0), label: entry[0], icon: entry[1] };
    }

    function buildAdvisoriesClient(day) {
        const adv = [];
        const wMax = day.wind_max_kmh || 0;
        const gMax = day.wind_gusts_kmh || 0;
        if (wMax >= 30 || gMax >= 45) {
            adv.push({ domain: 'BALÍSTICA & UAV', icon: 'air', level: 'danger', text: `Viento fuerte (${Math.round(wMax)} km/h, rachas ${Math.round(gMax)} km/h). Alta deriva lateral en BBs; vuelo UAV no recomendado.` });
        } else if (wMax >= 16 || gMax >= 28) {
            adv.push({ domain: 'BALÍSTICA & UAV', icon: 'air', level: 'warning', text: `Viento moderado (${Math.round(wMax)} km/h). Recomendado gramaje pesado (≥0.28g/0.32g) y precaución con drones.` });
        } else {
            adv.push({ domain: 'BALÍSTICA & UAV', icon: 'air', level: 'success', text: `Viento suave (${Math.round(wMax)} km/h). Condiciones óptimas de tiro tenso y reconocimiento UAV.` });
        }

        const pMm = day.precip_sum_mm || 0;
        const pProb = day.precip_prob_max;
        if (pMm >= 5 || (pProb !== null && pProb >= 65)) {
            adv.push({ domain: 'TERRENO & EQUIPO', icon: 'rainy', level: 'danger', text: `Lluvia prevista (${pMm.toFixed(1)} mm${pProb !== null ? ` · ${pProb}%` : ''}). Impermeabilizar radios/ópticas y prever barro.` });
        } else if (pMm >= 0.5 || (pProb !== null && pProb >= 30)) {
            adv.push({ domain: 'TERRENO & EQUIPO', icon: 'umbrella', level: 'warning', text: `Posibles precipitaciones débiles (${pMm.toFixed(1)} mm). Llevar capa impermeable ligera.` });
        } else {
            adv.push({ domain: 'TERRENO & EQUIPO', icon: 'landscape', level: 'success', text: 'Baja probabilidad de lluvia. Firme seco y buena tracción a pie.' });
        }

        if (day.temp_min <= 4) {
            adv.push({ domain: 'ESTRÉS TÉRMICO', icon: 'ac_unit', level: day.temp_min <= 0 ? 'danger' : 'warning', text: `Frío nocturno/matinal (mín. ${day.temp_min.toFixed(1)}°C). Proteger baterías LiPo/Gas y abrigo térmico en estático.` });
        } else if (day.temp_max >= 30) {
            adv.push({ domain: 'ESTRÉS TÉRMICO', icon: 'thermostat', level: day.temp_max >= 35 ? 'danger' : 'warning', text: `Calor diurno (${day.temp_max.toFixed(1)}°C). Reforzar hidratación (+3L) y sales minerales.` });
        } else {
            adv.push({ domain: 'ESTRÉS TÉRMICO', icon: 'thermostat', level: 'success', text: `Rango térmico favorable (${day.temp_min.toFixed(1)}°C a ${day.temp_max.toFixed(1)}°C).` });
        }

        const moon = day.moon || { phase_name: 'Luna', illumination_pct: 0, nvg_note: '' };
        adv.push({
            domain: 'OPERACIÓN NOCTURNA / NVG',
            icon: 'dark_mode',
            level: moon.illumination_pct >= 50 ? 'success' : 'info',
            text: `${moon.phase_name} (${moon.illumination_pct}% ilum.). ${moon.nvg_note || ''}`
        });
        return adv;
    }

    function extractDayClient(rawJson, queryDateStr, realEventDateStr, dateLabel, dayTag, sourceType, moonObj) {
        if (!rawJson || !rawJson.daily || !Array.isArray(rawJson.daily.time)) return null;
        const dIdx = rawJson.daily.time.indexOf(queryDateStr);
        if (dIdx === -1) return null;

        const d = rawJson.daily;
        const h = rawJson.hourly || {};
        const hTimes = h.time || [];
        const hourlyOut = [];

        for (let i = 0; i < hTimes.length; i++) {
            const ts = String(hTimes[i] || '');
            if (!ts.startsWith(queryDateStr)) continue;
            const hhmm = ts.includes('T') ? ts.split('T')[1].slice(0, 5) : '00:00';
            const wDir = h.wind_direction_10m ? h.wind_direction_10m[i] : 0;
            hourlyOut.push({
                hour: hhmm,
                hour_int: parseInt(hhmm.slice(0, 2), 10) || 0,
                temp: Number((h.temperature_2m && h.temperature_2m[i]) || 0),
                apparent_temp: Number((h.apparent_temperature && h.apparent_temperature[i]) || 0),
                humidity: Math.round(Number((h.relative_humidity_2m && h.relative_humidity_2m[i]) || 0)),
                precip_prob: h.precipitation_probability ? h.precipitation_probability[i] : null,
                precip_mm: Number((h.precipitation && h.precipitation[i]) || 0),
                cloud_cover: Math.round(Number((h.cloud_cover && h.cloud_cover[i]) || 0)),
                wind_kmh: Number((h.wind_speed_10m && h.wind_speed_10m[i]) || 0),
                wind_gusts_kmh: Number((h.wind_gusts_10m && h.wind_gusts_10m[i]) || 0),
                wind_dir_deg: Math.round(Number(wDir || 0)),
                wind_cardinal: degToCardinal(wDir),
                visibility_km: (h.visibility && h.visibility[i] != null) ? Number((h.visibility[i] / 1000).toFixed(1)) : null,
                weather: wmoMeta(h.weather_code ? h.weather_code[i] : 0)
            });
        }

        const sunriseRaw = (d.sunrise && d.sunrise[dIdx]) || '';
        const sunsetRaw = (d.sunset && d.sunset[dIdx]) || '';
        const domDeg = d.wind_direction_10m_dominant ? d.wind_direction_10m_dominant[dIdx] : null;

        const summary = {
            date: realEventDateStr,
            date_label: dateLabel,
            day_tag: dayTag,
            source_type: sourceType,
            weather: wmoMeta(d.weather_code ? d.weather_code[dIdx] : 0),
            temp_max: Number((d.temperature_2m_max && d.temperature_2m_max[dIdx]) || 0),
            temp_min: Number((d.temperature_2m_min && d.temperature_2m_min[dIdx]) || 0),
            apparent_max: Number((d.apparent_temperature_max && d.apparent_temperature_max[dIdx]) || 0),
            apparent_min: Number((d.apparent_temperature_min && d.apparent_temperature_min[dIdx]) || 0),
            sunrise: sunriseRaw.includes('T') ? sunriseRaw.split('T')[1].slice(0, 5) : '--:--',
            sunset: sunsetRaw.includes('T') ? sunsetRaw.split('T')[1].slice(0, 5) : '--:--',
            precip_sum_mm: Number((d.precipitation_sum && d.precipitation_sum[dIdx]) || 0),
            precip_prob_max: d.precipitation_probability_max ? d.precipitation_probability_max[dIdx] : null,
            wind_max_kmh: Number((d.wind_speed_10m_max && d.wind_speed_10m_max[dIdx]) || 0),
            wind_gusts_kmh: Number((d.wind_gusts_10m_max && d.wind_gusts_10m_max[dIdx]) || 0),
            wind_dir_deg: domDeg != null ? Math.round(Number(domDeg)) : null,
            wind_cardinal: degToCardinal(domDeg),
            uv_max: d.uv_index_max ? d.uv_index_max[dIdx] : null,
            moon: moonObj || { phase_name: 'Luna', emoji: '🌙', illumination_pct: 50, nvg_note: '' },
            hourly: hourlyOut
        };
        summary.advisories = buildAdvisoriesClient(summary);
        return summary;
    }

    async function resolveClientFallback(fb) {
        let fJson = null;
        let aJson = null;
        if (fb.urls && fb.urls.forecast) {
            const r = await fetch(fb.urls.forecast);
            if (r.ok) fJson = await r.json();
        }
        if (fb.urls && fb.urls.archive) {
            const r = await fetch(fb.urls.archive);
            if (r.ok) aJson = await r.json();
        }

        const eventDays = [];
        for (const spec of (fb.event_days_spec || [])) {
            const srcJson = spec.query_source === 'archive' ? aJson : fJson;
            const entry = extractDayClient(srcJson, spec.query_date, spec.event_date, spec.date_label, spec.day_tag, spec.source_type, spec.moon);
            if (entry) eventDays.push(entry);
        }

        let currentCond = null;
        if (fJson && fJson.current) {
            const c = fJson.current;
            currentCond = {
                time: String(c.time || '').replace('T', ' '),
                temp: Number(c.temperature_2m || 0),
                apparent_temp: Number(c.apparent_temperature || 0),
                humidity: Math.round(Number(c.relative_humidity_2m || 0)),
                precip_mm: Number(c.precipitation || 0),
                cloud_cover: Math.round(Number(c.cloud_cover || 0)),
                pressure_hpa: Number(c.surface_pressure || 1013),
                wind_kmh: Number(c.wind_speed_10m || 0),
                wind_gusts_kmh: Number(c.wind_gusts_10m || 0),
                wind_dir_deg: Math.round(Number(c.wind_direction_10m || 0)),
                wind_cardinal: degToCardinal(c.wind_direction_10m),
                weather: wmoMeta(c.weather_code || 0)
            };
        }

        let todayZone = null;
        if (fJson && (fb.phase === 'PRE_VENTANA' || fb.phase === 'PRE_EVENTO')) {
            todayZone = extractDayClient(fJson, fb.today_iso, fb.today_iso, 'Hoy en Zona', 'HOY EN ZONA', 'HOY_ZONA', null);
        }

        return {
            status: 'ok',
            generated_at: new Date().toLocaleString('es-ES'),
            from_cache: false,
            config: fb.config,
            elevation_m: (fJson && fJson.elevation != null) ? Math.round(fJson.elevation) : null,
            phase: fb.phase,
            phase_label: fb.phase_label,
            phase_desc: fb.phase_desc,
            days_until: fb.days_until,
            today_iso: fb.today_iso,
            current_in_zone: currentCond,
            today_in_zone: todayZone,
            event_days: eventDays
        };
    }

    function sourceBadgeHtml(sourceType) {
        if (sourceType === 'MODELO_DETERMINISTA') {
            return `<span class="metoc-source-badge metoc-source-MODELO_DETERMINISTA"><span class="material-symbols-outlined" style="font-size:15px;">satellite_alt</span> PREVISIÓN MODELO OFICIAL (16D)</span>`;
        }
        if (sourceType === 'REFERENCIA_HISTORICA') {
            return `<span class="metoc-source-badge metoc-source-REFERENCIA_HISTORICA"><span class="material-symbols-outlined" style="font-size:15px;">history</span> ESTIMACIÓN CLIMÁTICA HISTÓRICA (&gt;16D)</span>`;
        }
        if (sourceType === 'HOY_ZONA') {
            return `<span class="metoc-source-badge metoc-source-HOY_ZONA"><span class="material-symbols-outlined" style="font-size:15px;">sensors</span> ESTADO DE ZONA HOY</span>`;
        }
        return `<span class="metoc-source-badge metoc-source-REGISTRO_REAL"><span class="material-symbols-outlined" style="font-size:15px;">fact_check</span> REGISTRO METEOROLÓGICO CONSOLIDADO</span>`;
    }

    function windArrowHtml(deg) {
        if (deg === null || deg === undefined || isNaN(deg)) return '';
        // El viento meteorológico indica de dónde VIENE; rotamos +180° para que la flecha apunte hacia donde SOPLA
        const blowTo = (Number(deg) + 180) % 360;
        return `<span class="metoc-wind-arrow" title="Dirección origen: ${deg}°"><span class="material-symbols-outlined" style="font-size:14px; transform: rotate(${blowTo}deg); display:inline-block;">navigation</span></span>`;
    }

    function renderInstance(containerId) {
        const state = instances[containerId];
        if (!state) return;
        const root = document.querySelector(containerId);
        if (!root) return;

        const data = state.data;
        if (!data) return;

        const cfg = data.config || {};
        const isAdmin = !!state.isAdmin;

        if (data.status === 'disabled' && !isAdmin) {
            root.innerHTML = `
                <div class="metoc-wrapper">
                    <div class="metoc-header-card" style="border-color: rgba(245,158,11,0.4);">
                        <h3 class="metoc-title" style="color:#fbbf24;">
                            <span class="material-symbols-outlined">cloud_off</span>
                            SISTEMA METOC EN PAUSA OPERATIVA
                        </h3>
                        <p style="color:#cbd5e1; font-size:0.9rem; margin:10px 0 0 0;">${escHtml(data.message || 'Servicio temporalmente deshabilitado por Dirección.')}</p>
                    </div>
                </div>
            `;
            return;
        }

        // Construir lista de pestañas: días del evento (partiendo desde el día 1 del evento) + opcional Hoy en Zona
        const allTabs = (data.event_days || []).map((d, idx) => ({
            key: `ev_${idx}`,
            day: d,
            isTodayZone: false
        }));
        if (data.today_in_zone) {
            allTabs.push({
                key: 'today_zone',
                day: data.today_in_zone,
                isTodayZone: true
            });
        }

        if (!state.selectedTabKey || !allTabs.some(t => t.key === state.selectedTabKey)) {
            // Si el evento está EN_CURSO, seleccionar el día actual del evento; si no, empezar desde DÍA 1 del evento
            const activeTodayIdx = allTabs.findIndex(t => !t.isTodayZone && t.day.date === data.today_iso);
            state.selectedTabKey = activeTodayIdx >= 0 ? allTabs[activeTodayIdx].key : (allTabs[0] ? allTabs[0].key : null);
        }

        const activeTab = allTabs.find(t => t.key === state.selectedTabKey) || allTabs[0] || null;
        const cur = data.current_in_zone;

        // Enlace opcional a Google Maps si coordenadas exactas habilitadas o es Admin
        const showMapLink = (isAdmin || cfg.mostrar_coordenadas_exactas) && cfg.lat != null && cfg.lng != null;
        const mapsUrl = showMapLink ? `https://www.google.com/maps?q=${encodeURIComponent(cfg.lat + ',' + cfg.lng)}` : '';

        let adminPanelHtml = '';
        if (isAdmin && state.showAdminConfig) {
            adminPanelHtml = `
                <div class="metoc-admin-panel">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:10px; flex-wrap:wrap; gap:8px;">
                        <div style="font-family:'Orbitron',monospace; font-size:0.95rem; font-weight:700; color:#fbbf24; display:flex; align-items:center; gap:8px;">
                            <span class="material-symbols-outlined">tune</span>
                            CONFIGURACIÓN MANDO // ZONA Y FECHA DEL EVENTO
                        </div>
                        <div style="display:flex; gap:8px; flex-wrap:wrap;">
                            <button type="button" class="metoc-btn" data-metoc-action="preset-tvc" style="font-size:0.74rem; padding:5px 10px;">
                                <span class="material-symbols-outlined" style="font-size:15px;">my_location</span> Centro Mapa TVC
                            </button>
                            <button type="button" class="metoc-btn" data-metoc-action="preset-gps" style="font-size:0.74rem; padding:5px 10px;">
                                <span class="material-symbols-outlined" style="font-size:15px;">gps_fixed</span> Usar mi GPS
                            </button>
                        </div>
                    </div>

                    <form data-metoc-form="admin-config">
                        <div class="metoc-admin-grid">
                            <div class="metoc-field">
                                <label>Nombre de Zona / Sector AO</label>
                                <input type="text" name="zona_nombre" value="${escHtml(cfg.zona_nombre || '')}" required placeholder="Ej: Sector Sierra // Campo TVC">
                            </div>
                            <div class="metoc-field">
                                <label>Fecha de Inicio del Evento</label>
                                <input type="date" name="fecha_inicio" value="${escHtml(cfg.fecha_inicio || '')}" required>
                            </div>
                            <div class="metoc-field">
                                <label>Duración del Evento (Jornadas)</label>
                                <select name="duracion_dias">
                                    ${[1, 2, 3, 4, 5, 6, 7].map(n => `<option value="${n}" ${Number(cfg.duracion_dias) === n ? 'selected' : ''}>${n} día${n > 1 ? 's' : ''}</option>`).join('')}
                                </select>
                            </div>
                            <div class="metoc-field">
                                <label>Latitud GPS (Decimal)</label>
                                <input type="number" step="0.000001" name="lat" value="${escHtml(cfg.lat)}" required>
                            </div>
                            <div class="metoc-field">
                                <label>Longitud GPS (Decimal)</label>
                                <input type="number" step="0.000001" name="lng" value="${escHtml(cfg.lng)}" required>
                            </div>
                            <div class="metoc-field" style="display:flex; flex-direction:column; justify-content:center; gap:8px; padding-top:8px;">
                                <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:#e2e8f0; text-transform:none; margin:0; font-size:0.82rem;">
                                    <input type="checkbox" name="activo" ${cfg.activo ? 'checked' : ''} style="width:16px; height:16px;">
                                    Servicio METOC visible a jugadores
                                </label>
                                <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:#cbd5e1; text-transform:none; margin:0; font-size:0.8rem;">
                                    <input type="checkbox" name="mostrar_coordenadas_exactas" ${cfg.mostrar_coordenadas_exactas ? 'checked' : ''} style="width:16px; height:16px;">
                                    Mostrar coordenadas exactas (OPSEC)
                                </label>
                            </div>
                        </div>

                        <div class="metoc-field" style="margin-bottom:14px;">
                            <label>Directiva / Aviso Meteorológico de Mando (Visible para Equipos y Operadores)</label>
                            <textarea name="notas_mando" rows="2" placeholder="Opcional. Ej: Prevista helada nocturna en cota alta. Obligatorio saco térmico 0°C y capa impermeable.">${escHtml(cfg.notas_mando || '')}</textarea>
                        </div>

                        <div style="display:flex; justify-content:flex-end; gap:10px;">
                            <button type="button" class="metoc-btn" data-metoc-action="toggle-admin" style="border-color:#64748b; color:#cbd5e1; background:transparent;">Cancelar</button>
                            <button type="submit" class="metoc-btn metoc-btn-admin" style="background:#f59e0b; color:#000; border-color:#f59e0b;">
                                <span class="material-symbols-outlined" style="font-size:17px;">save</span> GUARDAR Y RECALCULAR PARTE
                            </button>
                        </div>
                    </form>
                </div>
            `;
        }

        const hqNoteHtml = cfg.notas_mando ? `
            <div class="metoc-hq-note">
                <span class="material-symbols-outlined" style="color:#f59e0b; font-size:24px; flex-shrink:0;">campaign</span>
                <div>
                    <div style="font-family:'Share Tech Mono',monospace; font-size:0.75rem; font-weight:700; color:#fbbf24; letter-spacing:0.8px; text-transform:uppercase;">
                        DIRECTIVA METEOROLÓGICA DE DIRECCIÓN // AVISO A UNIDADES
                    </div>
                    <div style="font-size:0.88rem; color:#f8fafc; margin-top:3px; line-height:1.45;">
                        ${escHtml(cfg.notas_mando)}
                    </div>
                </div>
            </div>
        ` : '';

        const liveStripHtml = cur ? `
            <div class="metoc-live-strip">
                <div style="display:flex; align-items:center; gap:10px;">
                    <span class="material-symbols-outlined" style="font-size:26px; color:#38bdf8;">${escHtml(cur.weather.icon)}</span>
                    <div>
                        <div style="font-family:'Share Tech Mono',monospace; font-size:0.72rem; color:#38bdf8; letter-spacing:0.8px; font-weight:700;">
                            ESTADO ACTUAL EN ZONA AHORA MISMO (${escHtml(cur.time.split(' ')[1] || 'LIVE')})
                        </div>
                        <div style="font-size:0.9rem; font-weight:600; color:#fff;">
                            ${escHtml(cur.weather.label)} · <span style="color:#38bdf8;">${cur.temp.toFixed(1)}°C</span>
                            <span style="color:#94a3b8; font-size:0.8rem;">(Sensación ${cur.apparent_temp.toFixed(1)}°C)</span>
                        </div>
                    </div>
                </div>
                <div class="metoc-live-metrics">
                    <span title="Viento actual en zona">${windArrowHtml(cur.wind_dir_deg)} <b>${cur.wind_kmh.toFixed(0)} km/h</b> ${escHtml(cur.wind_cardinal)} <span style="color:#64748b;">(rachas ${cur.wind_gusts_kmh.toFixed(0)})</span></span>
                    <span title="Humedad relativa">💧 ${cur.humidity}%</span>
                    <span title="Precipitación actual">🌧️ ${cur.precip_mm.toFixed(1)} mm</span>
                    <span title="Presión atmosférica en superficie">🧭 ${cur.pressure_hpa.toFixed(0)} hPa</span>
                </div>
            </div>
        ` : '';

        let dayBodyHtml = '';
        if (activeTab && activeTab.day) {
            const d = activeTab.day;
            const currentHourNum = new Date().getHours();
            const isSelectedToday = (d.date === data.today_iso);
            const hoursFiltered = state.hourlyMode === '1h'
                ? (d.hourly || [])
                : (d.hourly || []).filter(h => h.hour_int % 3 === 0);

            dayBodyHtml = `
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
                    <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                        <h4 style="margin:0; font-family:'Orbitron',monospace; font-size:1rem; color:#fff;">
                            ${escHtml(d.day_tag)} — ${escHtml(d.date_label)}
                        </h4>
                        ${sourceBadgeHtml(d.source_type)}
                    </div>
                    ${d.source_type === 'REFERENCIA_HISTORICA' ? `
                        <div style="font-size:0.78rem; color:#fbbf24; font-family:'Share Tech Mono',monospace;">
                            * Basado en histórico de la misma fecha en esta coordenada. Se actualizará a previsión exacta a 15 días del evento.
                        </div>
                    ` : ''}
                </div>

                <!-- 4 KPI CARDS -->
                <div class="metoc-kpi-grid">
                    <div class="metoc-kpi-card">
                        <div class="metoc-kpi-header">
                            <span>CONDICIÓN & TEMPERATURA</span>
                            <span class="material-symbols-outlined" style="color:#00f0ff; font-size:20px;">${escHtml(d.weather.icon)}</span>
                        </div>
                        <div class="metoc-kpi-main">
                            <span style="color:#f87171;">${d.temp_max.toFixed(1)}°</span>
                            <span style="font-size:1rem; color:#64748b;">/</span>
                            <span style="color:#38bdf8;">${d.temp_min.toFixed(1)}°C</span>
                        </div>
                        <div class="metoc-kpi-sub">
                            <strong style="color:#e2e8f0;">${escHtml(d.weather.label)}</strong><br>
                            Sensación: ${d.apparent_max.toFixed(0)}° / ${d.apparent_min.toFixed(0)}°C
                        </div>
                    </div>

                    <div class="metoc-kpi-card">
                        <div class="metoc-kpi-header">
                            <span>VECTOR DE VIENTO & RACHAS</span>
                            <span class="material-symbols-outlined" style="color:#38bdf8; font-size:20px;">air</span>
                        </div>
                        <div class="metoc-kpi-main">
                            <span>${d.wind_max_kmh.toFixed(0)} <small style="font-size:0.85rem; color:#94a3b8;">km/h</small></span>
                            ${windArrowHtml(d.wind_dir_deg)}
                        </div>
                        <div class="metoc-kpi-sub">
                            Rachas máx: <strong style="color:#fbbf24;">${d.wind_gusts_kmh.toFixed(0)} km/h</strong><br>
                            Rumbo dominante: <strong>${escHtml(d.wind_cardinal)}</strong> ${d.wind_dir_deg != null ? `(${d.wind_dir_deg}°)` : ''}
                        </div>
                    </div>

                    <div class="metoc-kpi-card">
                        <div class="metoc-kpi-header">
                            <span>PRECIPITACIÓN & TERRENO</span>
                            <span class="material-symbols-outlined" style="color:#60a5fa; font-size:20px;">water_drop</span>
                        </div>
                        <div class="metoc-kpi-main">
                            <span>${d.precip_prob_max != null ? `${d.precip_prob_max}%` : `${d.precip_sum_mm.toFixed(1)} mm`}</span>
                        </div>
                        <div class="metoc-kpi-sub">
                            Acumulado estimado: <strong style="color:#e2e8f0;">${d.precip_sum_mm.toFixed(1)} l/m² (mm)</strong><br>
                            ${d.uv_max != null ? `Índice UV máx: <strong>${Number(d.uv_max).toFixed(1)}</strong>` : 'Referencia pluviométrica histórica'}
                        </div>
                    </div>

                    <div class="metoc-kpi-card">
                        <div class="metoc-kpi-header">
                            <span>CICLO SOLAR & LUNA (NVG)</span>
                            <span class="material-symbols-outlined" style="color:#a78bfa; font-size:20px;">nightlight</span>
                        </div>
                        <div class="metoc-kpi-main" style="font-size:1.25rem;">
                            <span>☀️ ${escHtml(d.sunrise)}</span>
                            <span style="color:#64748b; font-size:0.9rem;">→</span>
                            <span>🌙 ${escHtml(d.sunset)}</span>
                        </div>
                        <div class="metoc-kpi-sub">
                            ${d.moon ? `${escHtml(d.moon.emoji || '🌙')} <strong style="color:#e2e8f0;">${escHtml(d.moon.phase_name)} (${d.moon.illumination_pct}%)</strong>` : ''}<br>
                            ${d.night_cloud_cover_avg != null ? `Nubosidad nocturna media: ${d.night_cloud_cover_avg}%` : ''}
                        </div>
                    </div>
                </div>

                <!-- SEMÁFORO DE IMPACTO TÁCTICO -->
                <div class="metoc-advisories-grid">
                    ${(d.advisories || []).map(adv => `
                        <div class="metoc-advisory-card lvl-${escHtml(adv.level)}">
                            <div class="metoc-advisory-title">
                                <span class="material-symbols-outlined" style="font-size:17px;">${escHtml(adv.icon)}</span>
                                ${escHtml(adv.domain)}
                            </div>
                            <div class="metoc-advisory-text">${escHtml(adv.text)}</div>
                        </div>
                    `).join('')}
                </div>

                <!-- EVOLUCIÓN HORARIA -->
                <div class="metoc-hourly-panel">
                    <div class="metoc-hourly-header">
                        <div style="font-family:'Orbitron',monospace; font-size:0.88rem; font-weight:700; color:#00f0ff; display:flex; align-items:center; gap:8px;">
                            <span class="material-symbols-outlined" style="font-size:19px;">schedule</span>
                            CRONOGRAMA METEOROLÓGICO POR FRANJAS (${escHtml(d.date_label)})
                        </div>
                        <div style="display:flex; gap:6px;">
                            <button type="button" class="metoc-btn" data-metoc-action="set-hourly" data-mode="3h" style="padding:4px 10px; font-size:0.74rem; ${state.hourlyMode !== '1h' ? 'background:rgba(0,240,255,0.25); border-color:#00f0ff;' : 'opacity:0.65;'}">
                                Táctico (Cada 3h)
                            </button>
                            <button type="button" class="metoc-btn" data-metoc-action="set-hourly" data-mode="1h" style="padding:4px 10px; font-size:0.74rem; ${state.hourlyMode === '1h' ? 'background:rgba(0,240,255,0.25); border-color:#00f0ff;' : 'opacity:0.65;'}">
                                Detalle 24h (1h)
                            </button>
                        </div>
                    </div>

                    <div class="metoc-table-scroll">
                        <table class="metoc-hourly-table">
                            <thead>
                                <tr>
                                    <th>HORA</th>
                                    <th>ESTADO</th>
                                    <th>TEMP / SENS.</th>
                                    <th>LLUVIA</th>
                                    <th>VIENTO / RACHAS</th>
                                    <th>NUBES / HUM.</th>
                                    <th>VISIBILIDAD</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${hoursFiltered.map(h => {
                                    const isNight = (h.hour_int >= 21 || h.hour_int <= 6);
                                    const isNow = isSelectedToday && (
                                        state.hourlyMode === '1h'
                                            ? h.hour_int === currentHourNum
                                            : (currentHourNum >= h.hour_int && currentHourNum < h.hour_int + 3)
                                    );
                                    const rowCls = [
                                        isNight ? 'is-night-row' : '',
                                        isNow ? 'is-current-hour' : ''
                                    ].filter(Boolean).join(' ');

                                    const probBadge = h.precip_prob != null
                                        ? `<span style="color:${h.precip_prob >= 50 ? '#60a5fa' : '#94a3b8'}; font-weight:${h.precip_prob >= 50 ? '700' : '400'};">${h.precip_prob}%</span> · `
                                        : '';

                                    return `
                                        <tr class="${rowCls}">
                                            <td style="font-family:'Share Tech Mono',monospace; font-weight:700; color:${isNow ? '#00f0ff' : '#f8fafc'};">
                                                ${isNight ? '🌙' : '☀️'} ${escHtml(h.hour)} ${isNow ? '<span style="font-size:0.66rem; background:#00f0ff; color:#000; padding:1px 5px; border-radius:3px; margin-left:4px;">AHORA</span>' : ''}
                                            </td>
                                            <td>
                                                <div style="display:flex; align-items:center; gap:6px;">
                                                    <span class="material-symbols-outlined" style="font-size:18px; color:#38bdf8;">${escHtml(h.weather.icon)}</span>
                                                    <span>${escHtml(h.weather.label)}</span>
                                                </div>
                                            </td>
                                            <td style="font-family:'Share Tech Mono',monospace;">
                                                <strong style="color:#fff;">${h.temp.toFixed(1)}°C</strong>
                                                <span style="color:#64748b; font-size:0.76rem;">(${h.apparent_temp.toFixed(1)}°)</span>
                                            </td>
                                            <td style="font-family:'Share Tech Mono',monospace;">
                                                ${probBadge}<span style="color:${h.precip_mm > 0 ? '#38bdf8' : '#64748b'};">${h.precip_mm.toFixed(1)} mm</span>
                                            </td>
                                            <td style="font-family:'Share Tech Mono',monospace;">
                                                ${windArrowHtml(h.wind_dir_deg)}
                                                <strong>${h.wind_kmh.toFixed(0)}</strong>
                                                <span style="color:#64748b;">/${h.wind_gusts_kmh.toFixed(0)} km/h</span>
                                                <span style="color:#94a3b8; font-size:0.75rem;">${escHtml(h.wind_cardinal)}</span>
                                            </td>
                                            <td style="font-family:'Share Tech Mono',monospace; color:#cbd5e1;">
                                                ☁️ ${h.cloud_cover}% · 💧 ${h.humidity}%
                                            </td>
                                            <td style="font-family:'Share Tech Mono',monospace; color:#94a3b8;">
                                                ${h.visibility_km != null ? `${h.visibility_km >= 10 ? '≥10' : h.visibility_km.toFixed(1)} km` : '--'}
                                            </td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }

        root.innerHTML = `
            <div class="metoc-wrapper">
                <!-- CABECERA METOC -->
                <div class="metoc-header-card">
                    <div class="metoc-header-top">
                        <div>
                            <div class="metoc-title-row">
                                <h3 class="metoc-title">
                                    <span class="material-symbols-outlined" style="font-size:26px;">partly_cloudy_day</span>
                                    INFORME METEOROLÓGICO // METOC
                                </h3>
                                ${!cfg.activo && isAdmin ? `<span class="metoc-phase-pill" style="background:rgba(239,68,68,0.2); border:1px solid #ef4444; color:#f87171;">OCULTO A JUGADORES</span>` : ''}
                            </div>
                            <div class="metoc-subtitle-meta">
                                <span class="metoc-meta-chip">
                                    <span class="material-symbols-outlined" style="font-size:15px; color:#00f0ff;">military_tech</span>
                                    ${escHtml(cfg.operacion_nombre || 'Operación TVC')}
                                </span>
                                <span class="metoc-meta-chip">
                                    <span class="material-symbols-outlined" style="font-size:15px; color:#fbbf24;">pin_drop</span>
                                    ${escHtml(cfg.zona_nombre || 'Zona AO')} · ${showMapLink ? `<a href="${mapsUrl}" target="_blank" rel="noopener" style="color:#38bdf8; text-decoration:underline;">${escHtml(cfg.coordenadas_texto)}</a>` : escHtml(cfg.coordenadas_texto || '')}
                                </span>
                                ${data.elevation_m != null ? `
                                    <span class="metoc-meta-chip">
                                        <span class="material-symbols-outlined" style="font-size:15px; color:#a3e635;">terrain</span>
                                        Cota ~${data.elevation_m} m
                                    </span>
                                ` : ''}
                                <span class="metoc-meta-chip">
                                    <span class="material-symbols-outlined" style="font-size:15px; color:#c084fc;">event</span>
                                    Inicio Evento: ${escHtml(cfg.fecha_inicio || '--')} (${cfg.duracion_dias || 1}d)
                                </span>
                            </div>
                        </div>

                        <div class="metoc-actions-bar">
                            <span style="font-family:'Share Tech Mono',monospace; font-size:0.73rem; color:#64748b;">
                                Consultado: ${escHtml(data.generated_at || '--')}
                            </span>
                            <button type="button" class="metoc-btn" data-metoc-action="refresh" title="Solicitar actualización bajo demanda">
                                <span class="material-symbols-outlined" style="font-size:17px;">refresh</span>
                                Actualizar Parte
                            </button>
                            ${isAdmin ? `
                                <button type="button" class="metoc-btn metoc-btn-admin" data-metoc-action="toggle-admin">
                                    <span class="material-symbols-outlined" style="font-size:17px;">settings</span>
                                    Configurar Zona / Fecha
                                </button>
                            ` : ''}
                        </div>
                    </div>

                    <div class="metoc-phase-banner">
                        <div style="display:flex; flex-direction:column; gap:5px; max-width:900px;">
                            <div>
                                <span class="metoc-phase-pill metoc-phase-${escHtml(data.phase)}">
                                    <span class="material-symbols-outlined" style="font-size:15px;">radar</span>
                                    ${escHtml(data.phase_label)}
                                </span>
                            </div>
                            <div style="font-size:0.83rem; color:#cbd5e1; line-height:1.4;">
                                ${escHtml(data.phase_desc)}
                            </div>
                        </div>
                        <div style="font-family:'Share Tech Mono',monospace; font-size:0.72rem; color:#64748b; align-self:flex-end;">
                            MODO BAJO DEMANDA · OPEN-METEO WMO
                        </div>
                    </div>
                </div>

                ${adminPanelHtml}
                ${hqNoteHtml}
                ${liveStripHtml}

                <!-- SELECTOR DE JORNADAS PARTIENDO DESDE EL DÍA DEL EVENTO -->
                <div style="font-family:'Share Tech Mono',monospace; font-size:0.75rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.8px; margin-bottom:8px;">
                    SELECCIONAR JORNADA OPERATIVA (DESDE EL DÍA DEL EVENTO):
                </div>
                <div class="metoc-days-tabs">
                    ${allTabs.map(tab => {
                        const td = tab.day;
                        const activeCls = tab.key === state.selectedTabKey ? 'active' : '';
                        return `
                            <button type="button" class="metoc-day-tab ${activeCls}" data-metoc-action="select-day" data-tab-key="${escHtml(tab.key)}">
                                <div class="metoc-day-tab-top">
                                    <span style="${tab.isTodayZone ? 'color:#38bdf8;' : ''}">${escHtml(td.day_tag)}</span>
                                    <span class="material-symbols-outlined" style="font-size:18px; color:${tab.isTodayZone ? '#38bdf8' : '#fbbf24'};">${escHtml(td.weather.icon)}</span>
                                </div>
                                <div class="metoc-day-tab-date">${escHtml(td.date_label)}</div>
                                <div class="metoc-day-tab-temps">
                                    <span style="color:#f87171;">${td.temp_max.toFixed(0)}°</span> /
                                    <span style="color:#38bdf8;">${td.temp_min.toFixed(0)}°C</span>
                                    <span style="margin-left:auto; font-size:0.74rem;">💧${td.precip_prob_max != null ? td.precip_prob_max + '%' : td.precip_sum_mm.toFixed(0) + 'mm'}</span>
                                </div>
                            </button>
                        `;
                    }).join('')}
                </div>

                ${dayBodyHtml}
            </div>
        `;

        bindEvents(containerId, root);
    }

    function bindEvents(containerId, root) {
        const state = instances[containerId];
        if (!state) return;

        root.querySelectorAll('[data-metoc-action]').forEach(btn => {
            btn.addEventListener('click', async (ev) => {
                const action = ev.currentTarget.getAttribute('data-metoc-action');
                if (action === 'select-day') {
                    state.selectedTabKey = ev.currentTarget.getAttribute('data-tab-key');
                    renderInstance(containerId);
                } else if (action === 'set-hourly') {
                    state.hourlyMode = ev.currentTarget.getAttribute('data-mode') || '3h';
                    renderInstance(containerId);
                } else if (action === 'refresh') {
                    await loadMetoc(containerId, { isAdmin: state.isAdmin, forceRefresh: true });
                } else if (action === 'toggle-admin') {
                    state.showAdminConfig = !state.showAdminConfig;
                    renderInstance(containerId);
                } else if (action === 'preset-tvc') {
                    const form = root.querySelector('[data-metoc-form="admin-config"]');
                    if (form) {
                        form.querySelector('[name="lat"]').value = DEFAULT_TVC_LAT;
                        form.querySelector('[name="lng"]').value = DEFAULT_TVC_LNG;
                    }
                } else if (action === 'preset-gps') {
                    if (!navigator.geolocation) {
                        alert('Geolocalización no soportada en este navegador.');
                        return;
                    }
                    navigator.geolocation.getCurrentPosition(pos => {
                        const form = root.querySelector('[data-metoc-form="admin-config"]');
                        if (form) {
                            form.querySelector('[name="lat"]').value = pos.coords.latitude.toFixed(6);
                            form.querySelector('[name="lng"]').value = pos.coords.longitude.toFixed(6);
                        }
                    }, err => {
                        alert('No se pudo obtener la posición GPS: ' + err.message);
                    }, { enableHighAccuracy: true, timeout: 8000 });
                }
            });
        });

        const adminForm = root.querySelector('[data-metoc-form="admin-config"]');
        if (adminForm) {
            adminForm.addEventListener('submit', async (ev) => {
                ev.preventDefault();
                const fd = new FormData(adminForm);
                const payload = {
                    zona_nombre: fd.get('zona_nombre'),
                    fecha_inicio: fd.get('fecha_inicio'),
                    duracion_dias: parseInt(fd.get('duracion_dias'), 10) || 3,
                    lat: parseFloat(fd.get('lat')),
                    lng: parseFloat(fd.get('lng')),
                    activo: adminForm.querySelector('[name="activo"]').checked,
                    mostrar_coordenadas_exactas: adminForm.querySelector('[name="mostrar_coordenadas_exactas"]').checked,
                    notas_mando: fd.get('notas_mando') || ''
                };

                try {
                    const res = await fetch('/api/admin/metoc/config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    const out = await res.json();
                    if (!res.ok || out.status !== 'success') {
                        alert(out.error || 'Error guardando configuración METOC');
                        return;
                    }
                    state.showAdminConfig = false;
                    state.selectedTabKey = null;
                    await loadMetoc(containerId, { isAdmin: state.isAdmin, forceRefresh: true });
                } catch (e) {
                    alert('Error de red al guardar configuración METOC.');
                }
            });
        }
    }

    async function loadMetoc(containerId, options = {}) {
        const root = document.querySelector(containerId);
        if (!root) return;

        if (!instances[containerId]) {
            instances[containerId] = {
                isAdmin: !!options.isAdmin,
                hourlyMode: '3h',
                selectedTabKey: null,
                showAdminConfig: false,
                data: null,
                loadedOnce: false
            };
        } else if (options.isAdmin !== undefined) {
            instances[containerId].isAdmin = !!options.isAdmin;
        }

        const state = instances[containerId];
        if (state.loadedOnce && !options.forceRefresh && state.data) {
            renderInstance(containerId);
            return;
        }

        root.innerHTML = `
            <div class="metoc-wrapper">
                <div class="metoc-header-card" style="text-align:center; padding:36px 20px;">
                    <span class="material-symbols-outlined" style="font-size:38px; color:#00f0ff; animation: spin 2s linear infinite;">sync</span>
                    <div style="font-family:'Orbitron',monospace; font-size:0.95rem; color:#00f0ff; margin-top:10px; letter-spacing:1px;">
                        ESTABLECIENDO ENLACE METEOROLÓGICO SOBRE ZONA DE OPERACIONES...
                    </div>
                    <div style="font-size:0.8rem; color:#94a3b8; margin-top:5px; font-family:'Share Tech Mono',monospace;">
                        Consulta puntual bajo demanda · Calculando parte desde el día del evento
                    </div>
                </div>
            </div>
        `;

        try {
            const url = options.forceRefresh ? '/api/metoc/report?force=1' : '/api/metoc/report';
            const res = await fetch(url, { cache: 'no-store' });
            let payload = await res.json();

            if (!res.ok) {
                throw new Error(payload.error || 'No se pudo obtener el informe meteorológico.');
            }

            if (payload.status === 'client_fallback') {
                payload = await resolveClientFallback(payload);
            }

            state.data = payload;
            state.loadedOnce = true;
            renderInstance(containerId);
        } catch (err) {
            root.innerHTML = `
                <div class="metoc-wrapper">
                    <div class="metoc-header-card" style="border-color:rgba(239,68,68,0.5);">
                        <h3 class="metoc-title" style="color:#f87171;">
                            <span class="material-symbols-outlined">warning</span>
                            SIN ENLACE METEOROLÓGICO
                        </h3>
                        <p style="color:#cbd5e1; font-size:0.88rem; margin:10px 0 14px 0;">
                            ${escHtml(err.message || 'Error al consultar el servicio meteorológico.')}
                        </p>
                        <button type="button" class="metoc-btn" id="metoc-retry-btn">
                            <span class="material-symbols-outlined" style="font-size:16px;">refresh</span> Reintentar Consulta
                        </button>
                    </div>
                </div>
            `;
            const retryBtn = root.querySelector('#metoc-retry-btn');
            if (retryBtn) {
                retryBtn.addEventListener('click', () => loadMetoc(containerId, { isAdmin: state.isAdmin, forceRefresh: true }));
            }
        }
    }

    window.TVC_METOC = {
        load: loadMetoc
    };
})();

