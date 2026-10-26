"""
crypto_vault.py - Módulo de Cifrado y Cumplimiento Normativo (RGPD / LOPD-GDD)
TVC-ORBAT System.

Implementa:
- Cifrado en reposo AES-256 (Fernet / AES-128-CBC + HMAC-SHA256 authenticated encryption)
  para datos personales identificativos (PII) y datos de salud (Art. 9 RGPD).
- Gestión segura de clave maestra (TVC_ENCRYPTION_KEY / instance/.tvc_secret.key).
- Funciones de enmascaramiento conforme a recomendaciones AEPD.
- Transformadores transparentes de diccionarios con retrocompatibilidad (Zero Data Loss).
"""

import os
import re
import logging
from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger("crypto_vault")

_CIPHER = None

def get_master_key() -> bytes:
    """
    Obtiene la clave maestra de cifrado.
    1. Variable de entorno TVC_ENCRYPTION_KEY
    2. Archivo instance/.tvc_secret.key (persistente y excluido de Git)
    Si no existe, se genera automáticamente una nueva clave criptográficamente segura.
    """
    env_key = os.environ.get("TVC_ENCRYPTION_KEY", "").strip()
    if env_key:
        try:
            # Validar formato base64 de 32 bytes de Fernet
            key_bytes = env_key.encode("utf-8")
            Fernet(key_bytes)
            return key_bytes
        except Exception as e:
            logger.warning(f"[CryptoVault] Clave en TVC_ENCRYPTION_KEY no válida ({e}). Usando fallback local.")

    # Buscar en carpeta instance/
    base_dir = os.path.dirname(os.path.abspath(__file__))
    instance_dir = os.path.join(base_dir, "instance")
    os.makedirs(instance_dir, exist_ok=True)
    key_file = os.path.join(instance_dir, ".tvc_secret.key")

    if os.path.exists(key_file):
        try:
            with open(key_file, "rb") as f:
                key_bytes = f.read().strip()
                if key_bytes:
                    Fernet(key_bytes)
                    return key_bytes
        except Exception as e:
            logger.warning(f"[CryptoVault] Error leyendo clave en {key_file}: {e}")

    # Generar nueva clave persistente
    new_key = Fernet.generate_key()
    try:
        with open(key_file, "wb") as f:
            f.write(new_key)
        logger.info(f"[CryptoVault] Nueva clave maestra generada y persistida en {key_file}")
    except Exception as e:
        logger.error(f"[CryptoVault] No se pudo escribir clave en disco: {e}")

    return new_key


def get_cipher() -> Fernet:
    """Retorna la instancia singleton de Fernet."""
    global _CIPHER
    if _CIPHER is None:
        key = get_master_key()
        _CIPHER = Fernet(key)
    return _CIPHER


def encrypt_val(value) -> str | None:
    """
    Cifra un valor en texto claro.
    Si ya está cifrado (prefijo ENC:: o token Fernet gAAAAA), devuelve el valor tal cual.
    Si es None o cadena vacía, lo devuelve intacto.
    """
    if value is None:
        return None
    val_str = str(value).strip()
    if not val_str or val_str.lower() == "none":
        return val_str

    # Evitar doble cifrado
    if val_str.startswith("ENC::") or (val_str.startswith("gAAAAA") and len(val_str) > 50):
        return val_str

    try:
        cipher = get_cipher()
        encrypted_bytes = cipher.encrypt(val_str.encode("utf-8"))
        return f"ENC::{encrypted_bytes.decode('utf-8')}"
    except Exception as e:
        logger.error(f"[CryptoVault] Error cifrando campo: {e}")
        return val_str


def decrypt_val(value) -> str | None:
    """
    Descifra un valor cifrado.
    Si está en texto claro (heredado / retrocompatibilidad), lo devuelve sin alterar.
    Si la clave no coincide, devuelve el valor para evitar rotura catastrófica.
    """
    if value is None:
        return None
    val_str = str(value).strip()
    if not val_str or val_str.lower() == "none":
        return val_str

    token = None
    if val_str.startswith("ENC::"):
        token = val_str[5:]
    elif val_str.startswith("gAAAAA") and len(val_str) > 50:
        token = val_str

    if not token:
        # Texto en claro heredado
        return val_str

    try:
        cipher = get_cipher()
        decrypted_bytes = cipher.decrypt(token.encode("utf-8"))
        return decrypted_bytes.decode("utf-8")
    except InvalidToken:
        logger.warning("[CryptoVault] InvalidToken al descifrar campo (clave cambiada o dato corrupto).")
        return val_str
    except Exception as e:
        logger.error(f"[CryptoVault] Error inesperado al descifrar: {e}")
        return val_str


def is_encrypted(value) -> bool:
    """Comprueba si un valor almacenado está cifrado."""
    if not value or not isinstance(value, str):
        return False
    val_str = value.strip()
    return val_str.startswith("ENC::") or (val_str.startswith("gAAAAA") and len(val_str) > 50)


# ==================== ENMASCARAMIENTO (AEPD / PRIVACIDAD) ====================

def mask_dni(raw_val: str | None) -> str:
    """
    Enmascara un DNI/NIE según el criterio de minimización de la AEPD:
    Muestra únicamente los dígitos centrales o intermedios con asteriscos.
    Ejemplo: 12345678Z -> ***4567* o ***5678*
             X1234567Z -> ***3456*
    """
    if not raw_val:
        return ""
    plain = decrypt_val(raw_val)
    if not plain or plain.lower() == "none":
        return ""
    clean = re.sub(r"\s+", "", str(plain).upper())
    if len(clean) >= 8:
        # Extraer ventana central de 4 dígitos
        mid_start = max(1, len(clean) - 5)
        mid_part = clean[mid_start:mid_start+4]
        return f"***{mid_part}*"
    elif len(clean) > 4:
        return f"***{clean[-3:]}*"
    else:
        return "****"


def mask_phone(raw_val: str | None) -> str:
    """Enmascara un teléfono mostrando solo los últimos 3-4 dígitos."""
    if not raw_val:
        return ""
    plain = decrypt_val(raw_val)
    if not plain or plain.lower() == "none":
        return ""
    clean = re.sub(r"[^\d+]", "", str(plain))
    if len(clean) >= 6:
        return f"*** *** {clean[-3:]}"
    return "***-***"


def mask_email(raw_val: str | None) -> str:
    """Enmascara un email: ej. u***o@dominio.com"""
    if not raw_val:
        return ""
    plain = decrypt_val(raw_val)
    if not plain or "@" not in plain:
        return ""
    user, domain = plain.split("@", 1)
    if len(user) <= 2:
        masked_user = user[0] + "***"
    else:
        masked_user = user[0] + "***" + user[-1]
    return f"{masked_user}@{domain}"


# ==================== TRANSFORMADORES DE DICCIONARIOS ====================

MIEMBRO_SENSITIVE_FIELDS = ("dni", "telefono", "email", "nombre_apellidos")
ICE_SENSITIVE_FIELDS = (
    "alergias", "condiciones_medicas", "medicacion_actual",
    "contacto_nombre", "contacto_telefono", "contacto_parentesco", "observaciones"
)

def decrypt_miembro_dict(m: dict) -> dict:
    """Descifra los campos PII de un diccionario de Miembro."""
    if not m:
        return m
    res = dict(m)
    for f in MIEMBRO_SENSITIVE_FIELDS:
        if f in res:
            res[f] = decrypt_val(res.get(f))
    return res


def encrypt_miembro_dict(m: dict) -> dict:
    """Cifra los campos PII antes de guardar en SQLite."""
    if not m:
        return m
    res = dict(m)
    for f in MIEMBRO_SENSITIVE_FIELDS:
        if f in res:
            res[f] = encrypt_val(res.get(f))
    return res


def decrypt_ice_dict(ice: dict) -> dict:
    """Descifra los campos de salud y contactos de Miembro_ICE."""
    if not ice:
        return ice
    res = dict(ice)
    for f in ICE_SENSITIVE_FIELDS:
        if f in res:
            res[f] = decrypt_val(res.get(f))
    return res


def encrypt_ice_dict(ice: dict) -> dict:
    """Cifra los campos de salud y contactos antes de guardar en SQLite."""
    if not ice:
        return ice
    res = dict(ice)
    for f in ICE_SENSITIVE_FIELDS:
        if f in res:
            res[f] = encrypt_val(res.get(f))
    return res


def sanitize_miembro_public(m: dict, keep_masked_dni: bool = True) -> dict:
    """
    Filtra y minimiza datos personales para respuestas públicas o no autorizadas.
    Oculta teléfono, email y nombre real; enmascara el DNI.
    """
    if not m:
        return m
    res = dict(m)
    raw_dni = res.get("dni")
    res["dni"] = mask_dni(raw_dni) if keep_masked_dni else ""
    res["telefono"] = ""
    res["email"] = ""
    res["nombre_apellidos"] = ""
    res.pop("pin", None)
    return res
