import json
import math
import time
import urllib.request
import urllib.parse
import urllib.error
from datetime import date, datetime, timedelta

# Coordenadas por defecto calibradas a partir del centroide de GPSMapper del campo TVC
DEFAULT_METOC_LAT = 41.959377
DEFAULT_METOC_LNG = -6.259835
DEFAULT_ZONA_NOMBRE = "Sector TVC // Zona de Operaciones"
DEFAULT_DURACION_DIAS = 3

# Caché en memoria bajo demanda (evita peticiones repetidas si varios jugadores consultan seguido)
CACHE_TTL_SECONDS = 900          # 15 minutos de validez
MIN_MANUAL_REFRESH_SECONDS = 60  # Anti-spam para refresco manual de usuarios no-admin
_METOC_CACHE = {}

# Diccionario táctico de códigos meteorológicos OMM (WMO)
WMO_CODES_ES = {
    0:  ("Cielo despejado", "sunny", "clear"),
    1:  ("Mayormente despejado", "partly_cloudy_day", "clear"),
    2:  ("Parcialmente nuboso", "partly_cloudy_day", "cloudy"),
    3:  ("Cielo cubierto", "cloud", "cloudy"),
    45: ("Niebla en superficie", "foggy", "fog"),
    48: ("Niebla engelante / escarcha", "foggy", "fog"),
    51: ("Llovizna débil", "rainy_light", "drizzle"),
    53: ("Llovizna moderada", "rainy_light", "drizzle"),
    55: ("Llovizna densa", "rainy", "drizzle"),
    56: ("Llovizna helada débil", "weather_mix", "snow"),
    57: ("Llovizna helada densa", "weather_mix", "snow"),
    61: ("Lluvia débil", "rainy", "rain"),
    63: ("Lluvia moderada", "rainy", "rain"),
    65: ("Lluvia intensa", "rainy_heavy", "rain"),
    66: ("Lluvia helada débil", "weather_mix", "snow"),
    67: ("Lluvia helada fuerte", "weather_mix", "snow"),
    71: ("Nevada débil", "weather_snowy", "snow"),
    73: ("Nevada moderada", "weather_snowy", "snow"),
    75: ("Nevada intensa", "weather_snowy", "snow"),
    77: ("Granos de nieve / cinarra", "weather_snowy", "snow"),
    80: ("Chubascos débiles", "rainy", "rain"),
    81: ("Chubascos moderados", "rainy", "rain"),
    82: ("Chubascos violentos", "thunderstorm", "storm"),
    85: ("Chubascos de nieve débiles", "weather_snowy", "snow"),
    86: ("Chubascos de nieve fuertes", "weather_snowy", "snow"),
    95: ("Tormenta eléctrica", "thunderstorm", "storm"),
    96: ("Tormenta con granizo leve", "thunderstorm", "storm"),
    99: ("Tormenta severa con granizo", "thunderstorm", "storm"),
}

DIAS_SEMANA_ES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
MESES_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]


def wmo_info(code):
    if code is None:
        return {"code": -1, "label": "Sin datos", "icon": "cloud", "category": "cloudy"}
    c = int(code)
    label, icon, cat = WMO_CODES_ES.get(c, ("Condición variable", "cloud", "cloudy"))
    # Normalizar iconos a Material Symbols estándar ampliamente soportados
    icon_map = {
        "rainy_light": "rainy",
        "rainy_heavy": "rainy",
        "weather_mix": "ac_unit",
        "weather_snowy": "ac_unit",
    }
    return {
        "code": c,
        "label": label,
        "icon": icon_map.get(icon, icon),
        "category": cat,
    }


def degrees_to_cardinal(deg):
    if deg is None:
        return "--"
    dirs = [
        "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
        "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"
    ]
    idx = int(round((float(deg) % 360) / 22.5)) % 16
    return dirs[idx]


def format_date_es(d_obj):
    return f"{DIAS_SEMANA_ES[d_obj.weekday()]} {d_obj.day:02d} {MESES_ES[d_obj.month - 1]}"


def compute_moon_phase(d_obj):
    """
    Calcula la fase e iluminación lunar para una fecha dada (cálculo astronómico sinótico).
    Crucial en operaciones Milsim nocturnas para estimar luminancia residual NVG.
    """
    # Época conocida de Luna Nueva: 2000-01-06 18:14 UTC
    dt = datetime(d_obj.year, d_obj.month, d_obj.day, 23, 0, 0)
    epoch = datetime(2000, 1, 6, 18, 14, 0)
    synodic_month = 29.530588853
    days_since = (dt - epoch).total_seconds() / 86400.0
    cycle_pos = (days_since % synodic_month) / synodic_month  # 0.0 .. 1.0

    # Fracción iluminada: 0 en 0.0 (nueva), 1.0 en 0.5 (llena)
    illum = 0.5 * (1.0 - math.cos(2.0 * math.pi * cycle_pos))
    illum_pct = int(round(illum * 100))

    if cycle_pos < 0.0625 or cycle_pos >= 0.9375:
        name = "Luna Nueva"
        emoji = "🌑"
    elif cycle_pos < 0.1875:
        name = "Creciente Cóncava"
        emoji = "🌒"
    elif cycle_pos < 0.3125:
        name = "Cuarto Creciente"
        emoji = "🌓"
    elif cycle_pos < 0.4375:
        name = "Gibosa Creciente"
        emoji = "🌔"
    elif cycle_pos < 0.5625:
        name = "Luna Llena"
        emoji = "🌕"
    elif cycle_pos < 0.6875:
        name = "Gibosa Menguante"
        emoji = "🌖"
    elif cycle_pos < 0.8125:
        name = "Cuarto Menguante"
        emoji = "🌗"
    else:
        name = "Menguante Cóncava"
        emoji = "🌘"

    if illum_pct >= 65:
        nvg_note = "Alta luz lunar residual (óptima para NVG pasivo sin IR)"
    elif illum_pct >= 25:
        nvg_note = "Luminancia lunar media (buen contraste en campo abierto)"
    else:
        nvg_note = "Oscuridad profunda (requiere iluminador IR en bosques/interiores)"

    return {
        "phase_name": name,
        "emoji": emoji,
        "illumination_pct": illum_pct,
        "nvg_note": nvg_note,
    }


def clear_metoc_cache():
    _METOC_CACHE.clear()


def ensure_metoc_table(conn):
    try:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS metoc_config (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                activo INTEGER DEFAULT 1,
                zona_nombre TEXT DEFAULT 'Sector TVC // Zona de Operaciones',
                lat REAL DEFAULT 41.959377,
                lng REAL DEFAULT -6.259835,
                fecha_inicio TEXT DEFAULT '',
                duracion_dias INTEGER DEFAULT 3,
                mostrar_coordenadas_exactas INTEGER DEFAULT 0,
                notas_mando TEXT DEFAULT '',
                actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        row = conn.execute('SELECT id FROM metoc_config WHERE id = 1').fetchone()
        if not row:
            default_fecha = ""
            try:
                op_row = conn.execute('SELECT fecha FROM Operacion WHERE id = 1').fetchone()
                if op_row and op_row['fecha']:
                    default_fecha = str(op_row['fecha']).strip()[:10]
            except Exception:
                pass
            if not default_fecha:
                default_fecha = (date.today() + timedelta(days=15)).isoformat()

            conn.execute('''
                INSERT INTO metoc_config (
                    id, activo, zona_nombre, lat, lng, fecha_inicio,
                    duracion_dias, mostrar_coordenadas_exactas, notas_mando
                ) VALUES (1, 1, ?, ?, ?, ?, ?, 0, '')
            ''', (DEFAULT_ZONA_NOMBRE, DEFAULT_METOC_LAT, DEFAULT_METOC_LNG, default_fecha, DEFAULT_DURACION_DIAS))
        conn.commit()
    except Exception as e:
        print("Error en ensure_metoc_table:", e)


def get_metoc_config(conn, is_admin=False):
    ensure_metoc_table(conn)
    row = conn.execute('SELECT * FROM metoc_config WHERE id = 1').fetchone()
    op_nombre = "Operación TVC"
    try:
        op_row = conn.execute('SELECT nombre, fecha FROM Operacion WHERE id = 1').fetchone()
        if op_row and op_row['nombre']:
            op_nombre = op_row['nombre']
    except Exception:
        pass

    if not row:
        return {
            "activo": True,
            "operacion_nombre": op_nombre,
            "zona_nombre": DEFAULT_ZONA_NOMBRE,
            "lat": DEFAULT_METOC_LAT if is_admin else round(DEFAULT_METOC_LAT, 2),
            "lng": DEFAULT_METOC_LNG if is_admin else round(DEFAULT_METOC_LNG, 2),
            "coordenadas_texto": f"{abs(DEFAULT_METOC_LAT):.2f}°N, {abs(DEFAULT_METOC_LNG):.2f}°O",
            "mostrar_coordenadas_exactas": False,
            "fecha_inicio": (date.today() + timedelta(days=15)).isoformat(),
            "duracion_dias": DEFAULT_DURACION_DIAS,
            "notas_mando": "",
            "actualizado_en": "",
        }

    lat_val = float(row['lat']) if row['lat'] is not None else DEFAULT_METOC_LAT
    lng_val = float(row['lng']) if row['lng'] is not None else DEFAULT_METOC_LNG
    exact = bool(row['mostrar_coordenadas_exactas'])

    ns = "N" if lat_val >= 0 else "S"
    ew = "E" if lng_val >= 0 else "O"
    if exact or is_admin:
        coord_txt = f"{abs(lat_val):.5f}°{ns}, {abs(lng_val):.5f}°{ew}"
    else:
        coord_txt = f"{abs(lat_val):.2f}°{ns}, {abs(lng_val):.2f}°{ew} (Sector AO)"

    return {
        "activo": bool(row['activo']),
        "operacion_nombre": op_nombre,
        "zona_nombre": row['zona_nombre'] or DEFAULT_ZONA_NOMBRE,
        "lat": lat_val if (is_admin or exact) else round(lat_val, 2),
        "lng": lng_val if (is_admin or exact) else round(lng_val, 2),
        "_raw_lat": lat_val,
        "_raw_lng": lng_val,
        "coordenadas_texto": coord_txt,
        "mostrar_coordenadas_exactas": exact,
        "fecha_inicio": str(row['fecha_inicio'] or '').strip()[:10],
        "duracion_dias": max(1, min(7, int(row['duracion_dias'] or DEFAULT_DURACION_DIAS))),
        "notas_mando": row['notas_mando'] or "",
        "actualizado_en": str(row['actualizado_en'] or ""),
    }


def save_metoc_config(conn, data):
    ensure_metoc_table(conn)
    cur = get_metoc_config(conn, is_admin=True)

    activo = 1 if data.get('activo', cur['activo']) else 0
    zona_nombre = str(data.get('zona_nombre', cur['zona_nombre'])).strip() or DEFAULT_ZONA_NOMBRE

    try:
        lat = float(data.get('lat', cur['_raw_lat']))
        lng = float(data.get('lng', cur['_raw_lng']))
    except (TypeError, ValueError):
        raise ValueError("Coordenadas GPS inválidas.")

    if not (-90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0):
        raise ValueError("Las coordenadas están fuera de rango geográfico (-90..90, -180..180).")

    fecha_inicio = str(data.get('fecha_inicio', cur['fecha_inicio'])).strip()[:10]
    try:
        date.fromisoformat(fecha_inicio)
    except ValueError:
        raise ValueError("Formato de fecha de inicio inválido (debe ser YYYY-MM-DD).")

    try:
        duracion_dias = max(1, min(7, int(data.get('duracion_dias', cur['duracion_dias']))))
    except (TypeError, ValueError):
        duracion_dias = DEFAULT_DURACION_DIAS

    mostrar_exactas = 1 if data.get('mostrar_coordenadas_exactas', cur['mostrar_coordenadas_exactas']) else 0
    notas_mando = str(data.get('notas_mando', cur['notas_mando'])).strip()

    conn.execute('''
        UPDATE metoc_config
        SET activo = ?, zona_nombre = ?, lat = ?, lng = ?, fecha_inicio = ?,
            duracion_dias = ?, mostrar_coordenadas_exactas = ?, notas_mando = ?,
            actualizado_en = CURRENT_TIMESTAMP
        WHERE id = 1
    ''', (activo, zona_nombre, lat, lng, fecha_inicio, duracion_dias, mostrar_exactas, notas_mando))

    # Sincronizar fecha en tabla Operacion (id=1) para coherencia global
    try:
        conn.execute('UPDATE Operacion SET fecha = ? WHERE id = 1', (fecha_inicio,))
    except Exception:
        pass

    conn.commit()
    clear_metoc_cache()
    return get_metoc_config(conn, is_admin=True)


def _http_get_json(url, timeout=7):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "TVC-ORBAT-METOC/1.0",
            "Accept": "application/json",
        }
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw)


def build_forecast_url(lat, lng, start_date_str, end_date_str, include_current=True):
    params = {
        "latitude": f"{lat:.5f}",
        "longitude": f"{lng:.5f}",
        "start_date": start_date_str,
        "end_date": end_date_str,
        "hourly": ",".join([
            "temperature_2m",
            "apparent_temperature",
            "relative_humidity_2m",
            "precipitation_probability",
            "precipitation",
            "weather_code",
            "cloud_cover",
            "wind_speed_10m",
            "wind_direction_10m",
            "wind_gusts_10m",
            "visibility",
        ]),
        "daily": ",".join([
            "weather_code",
            "temperature_2m_max",
            "temperature_2m_min",
            "apparent_temperature_max",
            "apparent_temperature_min",
            "sunrise",
            "sunset",
            "precipitation_sum",
            "precipitation_probability_max",
            "wind_speed_10m_max",
            "wind_gusts_10m_max",
            "wind_direction_10m_dominant",
            "uv_index_max",
        ]),
        "timezone": "auto",
    }
    if include_current:
        params["current"] = ",".join([
            "temperature_2m",
            "relative_humidity_2m",
            "apparent_temperature",
            "is_day",
            "precipitation",
            "weather_code",
            "cloud_cover",
            "surface_pressure",
            "wind_speed_10m",
            "wind_direction_10m",
            "wind_gusts_10m",
        ])
    return "https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode(params)


def build_archive_url(lat, lng, start_date_str, end_date_str):
    params = {
        "latitude": f"{lat:.5f}",
        "longitude": f"{lng:.5f}",
        "start_date": start_date_str,
        "end_date": end_date_str,
        "hourly": ",".join([
            "temperature_2m",
            "apparent_temperature",
            "relative_humidity_2m",
            "precipitation",
            "weather_code",
            "cloud_cover",
            "wind_speed_10m",
            "wind_direction_10m",
            "wind_gusts_10m",
        ]),
        "daily": ",".join([
            "weather_code",
            "temperature_2m_max",
            "temperature_2m_min",
            "apparent_temperature_max",
            "apparent_temperature_min",
            "sunrise",
            "sunset",
            "precipitation_sum",
            "wind_speed_10m_max",
            "wind_gusts_10m_max",
            "wind_direction_10m_dominant",
        ]),
        "timezone": "auto",
    }
    return "https://archive-api.open-meteo.com/v1/archive?" + urllib.parse.urlencode(params)


def _safe_idx(arr, idx, default=None):
    if not arr or idx < 0 or idx >= len(arr):
        return default
    val = arr[idx]
    return default if val is None else val


def _build_tactical_advisories(day_summary):
    advisories = []

    # 1. Viento / Balística BBs & Drones
    wind_max = day_summary.get("wind_max_kmh") or 0
    gust_max = day_summary.get("wind_gusts_kmh") or 0
    if wind_max >= 30 or gust_max >= 45:
        advisories.append({
            "domain": "BALÍSTICA & UAV",
            "icon": "air",
            "level": "danger",
            "text": f"Viento fuerte ({wind_max:.0f} km/h, rachas {gust_max:.0f} km/h). Alta deriva lateral en BBs; vuelo de drones no recomendado."
        })
    elif wind_max >= 16 or gust_max >= 28:
        advisories.append({
            "domain": "BALÍSTICA & UAV",
            "icon": "air",
            "level": "warning",
            "text": f"Viento moderado ({wind_max:.0f} km/h). Se recomienda gramaje pesado (≥0.28g/0.32g) y precaución con drones ligeros."
        })
    else:
        advisories.append({
            "domain": "BALÍSTICA & UAV",
            "icon": "air",
            "level": "success",
            "text": f"Viento suave ({wind_max:.0f} km/h). Condiciones óptimas de tiro tenso, humo táctico y reconocimiento UAV."
        })

    # 2. Precipitación / Terreno & Estanqueidad
    precip_mm = day_summary.get("precip_sum_mm") or 0
    precip_prob = day_summary.get("precip_prob_max")
    if precip_mm >= 5.0 or (precip_prob is not None and precip_prob >= 65):
        prob_str = f" ({precip_prob}% prob.)" if precip_prob is not None else ""
        advisories.append({
            "domain": "TERRENO & EQUIPO",
            "icon": "rainy",
            "level": "danger",
            "text": f"Lluvia prevista ({precip_mm:.1f} mm{prob_str}). Impermeabilizar radios/ópticas, prever barro en vaguadas y ropa de agua."
        })
    elif precip_mm >= 0.5 or (precip_prob is not None and precip_prob >= 30):
        prob_str = f" ({precip_prob}% prob.)" if precip_prob is not None else ""
        advisories.append({
            "domain": "TERRENO & EQUIPO",
            "icon": "umbrella",
            "level": "warning",
            "text": f"Riesgo de precipitaciones débiles ({precip_mm:.1f} mm{prob_str}). Llevar capa impermeable ligera y fundas estancas."
        })
    else:
        advisories.append({
            "domain": "TERRENO & EQUIPO",
            "icon": "landscape",
            "level": "success",
            "text": "Baja probabilidad de lluvia. Firme seco y buena tracción en desplazamientos a pie."
        })

    # 3. Estrés Térmico
    t_min = day_summary.get("temp_min")
    t_max = day_summary.get("temp_max")
    if t_min is not None and t_min <= 4.0:
        advisories.append({
            "domain": "ESTRÉS TÉRMICO",
            "icon": "ac_unit",
            "level": "warning" if t_min > 0 else "danger",
            "text": f"Frío intenso nocturno/matinal (mín. {t_min:.1f}°C). Riesgo de enfriamiento en guardias estáticas y merma de baterías LiPo/Gas."
        })
    elif t_max is not None and t_max >= 30.0:
        advisories.append({
            "domain": "ESTRÉS TÉRMICO",
            "icon": "thermostat",
            "level": "warning" if t_max < 35 else "danger",
            "text": f"Calor elevado diurno (máx. {t_max:.1f}°C). Incrementar dotación mínima de agua (+3L) y sales minerales."
        })
    elif t_min is not None and t_max is not None:
        advisories.append({
            "domain": "ESTRÉS TÉRMICO",
            "icon": "thermostat",
            "level": "success",
            "text": f"Rango térmico operativo favorable ({t_min:.1f}°C a {t_max:.1f}°C). Rendimiento estable de baterías y gas."
        })

    # 4. Visibilidad Nocturna / NVG
    moon = day_summary.get("moon") or {}
    night_clouds = day_summary.get("night_cloud_cover_avg")
    illum = moon.get("illumination_pct", 0)
    if night_clouds is not None and night_clouds >= 75:
        nvg_lvl = "warning"
        nvg_txt = f"{moon.get('phase_name', 'Luna')} ({illum}%) con cielo nocturno muy cubierto ({night_clouds:.0f}% nubes). Baja luz estelar; prever apoyo IR."
    elif illum >= 50:
        nvg_lvl = "success"
        nvg_txt = f"{moon.get('phase_name', 'Luna')} ({illum}% ilum.) y buena claridad nocturna. Excelente rendimiento en visores NVG pasivos."
    else:
        nvg_lvl = "info"
        nvg_txt = f"{moon.get('phase_name', 'Luna')} ({illum}% ilum.). {moon.get('nvg_note', '')}"

    advisories.append({
        "domain": "OPERACIÓN NOCTURNA / NVG",
        "icon": "dark_mode",
        "level": nvg_lvl,
        "text": nvg_txt
    })

    return advisories


def _extract_day_entry(raw_json, target_date_str, real_event_date_obj, day_index_label, source_type):
    """
    Extrae el resumen diario y las franjas horarias de un JSON de Open-Meteo para `target_date_str`,
    mapeándolo a la fecha real del evento `real_event_date_obj`.
    """
    daily = raw_json.get("daily") or {}
    d_times = daily.get("time") or []
    if target_date_str not in d_times:
        return None

    d_idx = d_times.index(target_date_str)
    w_code = _safe_idx(daily.get("weather_code"), d_idx, 0)
    w_meta = wmo_info(w_code)

    sunrise_raw = _safe_idx(daily.get("sunrise"), d_idx, "")
    sunset_raw = _safe_idx(daily.get("sunset"), d_idx, "")
    sunrise_hhmm = sunrise_raw.split("T")[1][:5] if "T" in str(sunrise_raw) else "--:--"
    sunset_hhmm = sunset_raw.split("T")[1][:5] if "T" in str(sunset_raw) else "--:--"

    # Extraer horas del día
    hourly = raw_json.get("hourly") or {}
    h_times = hourly.get("time") or []
    hours_list = []
    night_clouds = []

    for h_i, t_str in enumerate(h_times):
        if not str(t_str).startswith(target_date_str):
            continue
        hhmm = str(t_str).split("T")[1][:5] if "T" in str(t_str) else "00:00"
        hour_num = int(hhmm[:2]) if hhmm[:2].isdigit() else 0
        hc = _safe_idx(hourly.get("weather_code"), h_i, 0)
        hw = wmo_info(hc)
        w_dir = _safe_idx(hourly.get("wind_direction_10m"), h_i, 0)
        clouds = _safe_idx(hourly.get("cloud_cover"), h_i, 0)
        vis_m = _safe_idx(hourly.get("visibility"), h_i, None)

        if hour_num >= 21 or hour_num <= 5:
            if clouds is not None:
                night_clouds.append(float(clouds))

        hours_list.append({
            "hour": hhmm,
            "hour_int": hour_num,
            "temp": round(float(_safe_idx(hourly.get("temperature_2m"), h_i, 0.0)), 1),
            "apparent_temp": round(float(_safe_idx(hourly.get("apparent_temperature"), h_i, 0.0)), 1),
            "humidity": int(round(float(_safe_idx(hourly.get("relative_humidity_2m"), h_i, 0)))),
            "precip_prob": _safe_idx(hourly.get("precipitation_probability"), h_i, None),
            "precip_mm": round(float(_safe_idx(hourly.get("precipitation"), h_i, 0.0)), 1),
            "cloud_cover": int(round(float(clouds or 0))),
            "wind_kmh": round(float(_safe_idx(hourly.get("wind_speed_10m"), h_i, 0.0)), 1),
            "wind_gusts_kmh": round(float(_safe_idx(hourly.get("wind_gusts_10m"), h_i, 0.0)), 1),
            "wind_dir_deg": int(round(float(w_dir or 0))),
            "wind_cardinal": degrees_to_cardinal(w_dir),
            "visibility_km": round(float(vis_m) / 1000.0, 1) if vis_m is not None else None,
            "weather": hw,
        })

    dom_deg = _safe_idx(daily.get("wind_direction_10m_dominant"), d_idx, None)
    moon_data = compute_moon_phase(real_event_date_obj)
    night_cloud_avg = (sum(night_clouds) / len(night_clouds)) if night_clouds else None

    day_summary = {
        "date": real_event_date_obj.isoformat(),
        "date_label": format_date_es(real_event_date_obj),
        "day_tag": day_index_label,
        "source_type": source_type,  # 'MODELO_DETERMINISTA' | 'REGISTRO_REAL' | 'REFERENCIA_HISTORICA' | 'HOY_ZONA'
        "source_reference_date": target_date_str,
        "weather": w_meta,
        "temp_max": round(float(_safe_idx(daily.get("temperature_2m_max"), d_idx, 0.0)), 1),
        "temp_min": round(float(_safe_idx(daily.get("temperature_2m_min"), d_idx, 0.0)), 1),
        "apparent_max": round(float(_safe_idx(daily.get("apparent_temperature_max"), d_idx, 0.0)), 1),
        "apparent_min": round(float(_safe_idx(daily.get("apparent_temperature_min"), d_idx, 0.0)), 1),
        "sunrise": sunrise_hhmm,
        "sunset": sunset_hhmm,
        "precip_sum_mm": round(float(_safe_idx(daily.get("precipitation_sum"), d_idx, 0.0)), 1),
        "precip_prob_max": _safe_idx(daily.get("precipitation_probability_max"), d_idx, None),
        "wind_max_kmh": round(float(_safe_idx(daily.get("wind_speed_10m_max"), d_idx, 0.0)), 1),
        "wind_gusts_kmh": round(float(_safe_idx(daily.get("wind_gusts_10m_max"), d_idx, 0.0)), 1),
        "wind_dir_deg": int(round(float(dom_deg))) if dom_deg is not None else None,
        "wind_cardinal": degrees_to_cardinal(dom_deg),
        "uv_max": _safe_idx(daily.get("uv_index_max"), d_idx, None),
        "moon": moon_data,
        "night_cloud_cover_avg": round(night_cloud_avg, 0) if night_cloud_avg is not None else None,
        "hourly": hours_list,
    }
    day_summary["advisories"] = _build_tactical_advisories(day_summary)
    return day_summary


def _extract_current_conditions(raw_json):
    cur = raw_json.get("current")
    if not cur:
        return None
    w_meta = wmo_info(cur.get("weather_code", 0))
    w_dir = cur.get("wind_direction_10m")
    return {
        "time": str(cur.get("time", "")).replace("T", " "),
        "temp": round(float(cur.get("temperature_2m", 0.0)), 1),
        "apparent_temp": round(float(cur.get("apparent_temperature", 0.0)), 1),
        "humidity": int(round(float(cur.get("relative_humidity_2m", 0)))),
        "precip_mm": round(float(cur.get("precipitation", 0.0)), 1),
        "cloud_cover": int(round(float(cur.get("cloud_cover", 0)))),
        "pressure_hpa": round(float(cur.get("surface_pressure", 1013.0)), 1),
        "wind_kmh": round(float(cur.get("wind_speed_10m", 0.0)), 1),
        "wind_gusts_kmh": round(float(cur.get("wind_gusts_10m", 0.0)), 1),
        "wind_dir_deg": int(round(float(w_dir))) if w_dir is not None else 0,
        "wind_cardinal": degrees_to_cardinal(w_dir),
        "is_day": bool(cur.get("is_day", 1)),
        "weather": w_meta,
    }


def get_metoc_report(conn, is_admin=False, force_refresh=False):
    """
    Genera bajo demanda el informe METOC partiendo desde el día del evento.
    No realiza ninguna petición en segundo plano; únicamente cuando se invoca.
    """
    cfg = get_metoc_config(conn, is_admin=is_admin)
    if not cfg["activo"] and not is_admin:
        return {
            "status": "disabled",
            "message": "El sistema de informe meteorológico METOC está temporalmente desactivado por Dirección.",
            "config": cfg,
        }

    lat = cfg["_raw_lat"]
    lng = cfg["_raw_lng"]
    fecha_inicio_str = cfg["fecha_inicio"]
    duracion = cfg["duracion_dias"]

    today = date.today()
    try:
        ev_start = date.fromisoformat(fecha_inicio_str)
    except ValueError:
        ev_start = today + timedelta(days=15)
        fecha_inicio_str = ev_start.isoformat()

    ev_end = ev_start + timedelta(days=duracion - 1)
    max_forecast_date = today + timedelta(days=15)
    min_forecast_date = today - timedelta(days=90)

    cache_key = (round(lat, 4), round(lng, 4), fecha_inicio_str, duracion, today.isoformat())
    now_ts = time.time()

    if cache_key in _METOC_CACHE:
        entry = _METOC_CACHE[cache_key]
        age = now_ts - entry["ts"]
        allow_force = force_refresh and (is_admin or age >= MIN_MANUAL_REFRESH_SECONDS)
        if not allow_force and age < CACHE_TTL_SECONDS:
            payload = dict(entry["data"])
            # Ajustar visibilidad de config según rol solicitante
            clean_cfg = dict(cfg)
            clean_cfg.pop("_raw_lat", None)
            clean_cfg.pop("_raw_lng", None)
            payload["config"] = clean_cfg
            payload["from_cache"] = True
            payload["cache_age_sec"] = int(age)
            return payload

    # Determinar fase temporal respecto al día del evento
    if today < ev_start:
        days_until = (ev_start - today).days
        if ev_start > max_forecast_date:
            phase = "PRE_VENTANA"
            days_until_model = (ev_start - max_forecast_date).days
            phase_label = f"FASE PRELIMINAR // FALTAN {days_until} DÍAS"
            phase_desc = (
                f"El evento comienza el {format_date_es(ev_start)}. Los modelos meteorológicos deterministas cubren hasta 16 días vista "
                f"(la previsión exacta se activará en {days_until_model} día{'s' if days_until_model != 1 else ''}). "
                f"Se muestra referencia climatológica histórica para esas fechas y el estado actual en zona."
            )
        else:
            phase = "PRE_EVENTO"
            phase_label = f"PREVISIÓN ACTIVA // D-{days_until} PARA DESPLIEGUE"
            phase_desc = (
                f"Pronóstico meteorológico activo partiendo desde el día del evento ({format_date_es(ev_start)}). "
                f"Los datos se actualizan bajo demanda conforme se aproxima la Hora H."
            )
    elif ev_start <= today <= ev_end:
        days_until = 0
        day_num = (today - ev_start).days + 1
        phase = "EN_CURSO"
        phase_label = f"OPERACIÓN EN CURSO // DÍA {day_num} DE {duracion}"
        phase_desc = "Condiciones meteorológicas en tiempo real y evolución horaria sobre las coordenadas de la zona de operaciones."
    else:
        days_until = (ev_start - today).days
        phase = "POST_EVENTO"
        phase_label = "POST-EVENTO // REGISTRO METEOROLÓGICO"
        phase_desc = f"Registro meteorológico consolidado correspondiente a las jornadas del evento ({format_date_es(ev_start)} - {format_date_es(ev_end)})."

    # Planificar llamadas mínimas a Open-Meteo
    forecast_json = None
    archive_json = None
    event_days_dates = [ev_start + timedelta(days=i) for i in range(duracion)]

    # Fechas que entran en la API de forecast [min_forecast_date .. max_forecast_date]
    forecast_needed_dates = [d for d in event_days_dates if min_forecast_date <= d <= max_forecast_date]
    need_today_in_forecast = (phase in ("PRE_VENTANA", "PRE_EVENTO", "EN_CURSO"))

    f_start = None
    f_end = None
    if forecast_needed_dates or need_today_in_forecast:
        candidates = list(forecast_needed_dates)
        if need_today_in_forecast:
            candidates.append(today)
        f_start = min(candidates)
        f_end = max(candidates)

    # Fechas fuera de forecast (o >16 días en el futuro -> mismo día del año anterior en archive; o >90 días en el pasado)
    archive_map = {}  # event_date -> archive_query_date
    for d in event_days_dates:
        if d > max_forecast_date:
            # Mismo día/mes del año anterior que ya sea pasado (ej. hace 1 año)
            ref_year = d.year - 1
            while True:
                try:
                    ref_d = date(ref_year, d.month, d.day)
                except ValueError:
                    # 29 de febrero -> 28 de febrero
                    ref_d = date(ref_year, d.month, 28)
                if ref_d <= today - timedelta(days=5):
                    break
                ref_year -= 1
            archive_map[d] = ref_d
        elif d < min_forecast_date:
            archive_map[d] = d

    f_url = build_forecast_url(lat, lng, f_start.isoformat(), f_end.isoformat(), include_current=True) if f_start else None
    a_url = None
    if archive_map:
        a_start = min(archive_map.values())
        a_end = max(archive_map.values())
        a_url = build_archive_url(lat, lng, a_start.isoformat(), a_end.isoformat())

    try:
        if f_url:
            forecast_json = _http_get_json(f_url, timeout=7)
        if a_url:
            archive_json = _http_get_json(a_url, timeout=7)
    except Exception as net_err:
        # Si el servidor tiene restringida la salida HTTP (ej. proxy estricto), delegar limpiamente al navegador
        clean_cfg = dict(cfg)
        clean_cfg.pop("_raw_lat", None)
        clean_cfg.pop("_raw_lng", None)
        return {
            "status": "client_fallback",
            "error_detail": str(net_err),
            "config": clean_cfg,
            "phase": phase,
            "phase_label": phase_label,
            "phase_desc": phase_desc,
            "days_until": days_until,
            "today_iso": today.isoformat(),
            "urls": {
                "forecast": build_forecast_url(cfg["lat"], cfg["lng"], f_start.isoformat(), f_end.isoformat(), True) if f_start else None,
                "archive": build_archive_url(cfg["lat"], cfg["lng"], min(archive_map.values()).isoformat(), max(archive_map.values()).isoformat()) if archive_map else None,
            },
            "event_days_spec": [
                {
                    "event_date": d.isoformat(),
                    "date_label": format_date_es(d),
                    "day_tag": f"DÍA {idx + 1}",
                    "query_source": "archive" if d in archive_map else "forecast",
                    "query_date": archive_map[d].isoformat() if d in archive_map else d.isoformat(),
                    "source_type": (
                        "REFERENCIA_HISTORICA" if d > max_forecast_date
                        else ("REGISTRO_REAL" if d < today else "MODELO_DETERMINISTA")
                    ),
                    "moon": compute_moon_phase(d),
                }
                for idx, d in enumerate(event_days_dates)
            ]
        }

    # Construir lista de días del evento partiendo desde fecha_inicio
    event_days_out = []
    for idx, d in enumerate(event_days_dates):
        tag = f"DÍA {idx + 1}"
        if d == today:
            tag += " · HOY"
        if d in archive_map and archive_json:
            ref_d_str = archive_map[d].isoformat()
            s_type = "REFERENCIA_HISTORICA" if d > max_forecast_date else "REGISTRO_REAL"
            entry = _extract_day_entry(archive_json, ref_d_str, d, tag, s_type)
            if entry:
                event_days_out.append(entry)
        elif forecast_json:
            s_type = "REGISTRO_REAL" if d < today else "MODELO_DETERMINISTA"
            entry = _extract_day_entry(forecast_json, d.isoformat(), d, tag, s_type)
            if entry:
                event_days_out.append(entry)

    # Condiciones actuales y resumen de hoy en la zona (útil antes del evento para evaluar barro/terreno actual)
    current_cond = _extract_current_conditions(forecast_json) if forecast_json else None
    today_zone_day = None
    if forecast_json and phase in ("PRE_VENTANA", "PRE_EVENTO"):
        today_zone_day = _extract_day_entry(forecast_json, today.isoformat(), today, "HOY EN ZONA", "HOY_ZONA")

    elevation_m = None
    if forecast_json and forecast_json.get("elevation") is not None:
        elevation_m = int(round(float(forecast_json["elevation"])))
    elif archive_json and archive_json.get("elevation") is not None:
        elevation_m = int(round(float(archive_json["elevation"])))

    clean_cfg = dict(cfg)
    clean_cfg.pop("_raw_lat", None)
    clean_cfg.pop("_raw_lng", None)

    result = {
        "status": "ok",
        "generated_at": datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
        "from_cache": False,
        "cache_age_sec": 0,
        "config": clean_cfg,
        "elevation_m": elevation_m,
        "phase": phase,
        "phase_label": phase_label,
        "phase_desc": phase_desc,
        "days_until": days_until,
        "today_iso": today.isoformat(),
        "current_in_zone": current_cond,
        "today_in_zone": today_zone_day,
        "event_days": event_days_out,
    }

    _METOC_CACHE[cache_key] = {
        "ts": now_ts,
        "data": result,
    }
    return result

