#!/usr/bin/env python3
"""
Extract WXWork (Enterprise WeChat) cookies for *.buct.edu.cn and print them as JSON.
Works on Windows using the DPAPI-encrypted AES key stored in WXWork's Local State.
Usage: python extract-wxwork-cookies.py [--domain DOMAIN]
Output: JSON array of {name, value, domain, path, secure, httpOnly, expirationDate}
"""
import os, sys, json, sqlite3, base64, tempfile, ctypes, ctypes.wintypes
from pathlib import Path

TARGET_DOMAIN = 'buct.edu.cn'
if '--domain' in sys.argv:
    idx = sys.argv.index('--domain')
    if idx + 1 < len(sys.argv):
        TARGET_DOMAIN = sys.argv[idx + 1]


def dpapi_decrypt(data):
    class DATA_BLOB(ctypes.Structure):
        _fields_ = [('cbData', ctypes.wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_char))]
    p = ctypes.create_string_buffer(data, len(data))
    blobin = DATA_BLOB(ctypes.sizeof(p), p)
    blobout = DATA_BLOB()
    if not ctypes.windll.crypt32.CryptUnprotectData(
        ctypes.byref(blobin), None, None, None, None, 0, ctypes.byref(blobout)
    ):
        return None
    result = ctypes.string_at(blobout.pbData, blobout.cbData)
    ctypes.windll.kernel32.LocalFree(blobout.pbData)
    return result


def get_key_from_local_state(local_state_path):
    try:
        with open(local_state_path, 'r', encoding='utf-8') as f:
            state = json.load(f)
        encrypted_key_b64 = state.get('os_crypt', {}).get('encrypted_key')
        if not encrypted_key_b64:
            return None
        encrypted_key = base64.b64decode(encrypted_key_b64)
        if encrypted_key[:5] != b'DPAPI':
            return None
        return dpapi_decrypt(encrypted_key[5:])
    except Exception:
        return None


def find_local_state_for(cookies_path):
    """Walk up from the Cookies file looking for Local State (up to 8 levels)."""
    p = Path(cookies_path).parent
    for _ in range(8):
        candidate = p / 'Local State'
        if candidate.exists():
            return str(candidate)
        p = p.parent
    return None


def decrypt_value(key, encrypted_value):
    if not encrypted_value:
        return ''
    ev = bytes(encrypted_value)
    if ev[:3] in (b'v10', b'v11'):
        try:
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
            nonce = ev[3:15]
            ciphertext = ev[15:]
            return AESGCM(key).decrypt(nonce, ciphertext, None).decode('utf-8', errors='replace')
        except Exception:
            return ''
    # Pre-Chrome-80 per-cookie DPAPI encryption
    result = dpapi_decrypt(ev)
    return result.decode('utf-8', errors='replace') if result else ''


def read_locked_file(path):
    """Read a file that may be locked by another process using Win32 shared-access."""
    GENERIC_READ = 0x80000000
    FILE_SHARE_ALL = 0x7
    OPEN_EXISTING = 3
    k32 = ctypes.WinDLL('kernel32', use_last_error=True)
    handle = k32.CreateFileW(str(path), GENERIC_READ, FILE_SHARE_ALL, None, OPEN_EXISTING, 0x80, None)
    if handle == ctypes.c_void_p(-1).value:
        raise PermissionError(f'CreateFile failed with error {ctypes.get_last_error()}')
    try:
        size_high = ctypes.wintypes.DWORD(0)
        size_low = k32.GetFileSize(handle, ctypes.byref(size_high))
        size = (size_high.value << 32) | size_low
        buf = ctypes.create_string_buffer(size)
        read = ctypes.wintypes.DWORD(0)
        k32.ReadFile(handle, buf, size, ctypes.byref(read), None)
        return buf.raw[:read.value]
    finally:
        k32.CloseHandle(handle)


def is_sqlite(data):
    return data[:16] == b'SQLite format 3\x00'


def find_wxwork_cookie_dbs():
    """Locate all Chromium Cookies SQLite databases under WXWork's APPDATA directory."""
    appdata = os.environ.get('APPDATA', '')
    base = Path(appdata) / 'Tencent' / 'WXWork'
    if not base.exists():
        return []
    results = []
    for cookies_path in base.rglob('Cookies'):
        try:
            data = read_locked_file(cookies_path)
            if not is_sqlite(data):
                continue
            local_state = find_local_state_for(cookies_path)
            results.append((str(cookies_path), local_state, data))
        except Exception:
            continue
    return results


def extract_cookies(db_data, local_state_path, domain_filter):
    key = get_key_from_local_state(local_state_path) if local_state_path else None
    tmp = tempfile.mktemp(suffix='.db')
    try:
        with open(tmp, 'wb') as f:
            f.write(db_data)
        con = sqlite3.connect(tmp)
        con.row_factory = sqlite3.Row
        try:
            rows = con.execute(
                "SELECT name, encrypted_value, host_key, path, is_secure, is_httponly, expires_utc "
                "FROM cookies WHERE host_key LIKE ?",
                (f'%{domain_filter}',)
            ).fetchall()
        finally:
            con.close()
    except Exception:
        return []
    finally:
        try:
            os.unlink(tmp)
        except Exception:
            pass

    result = []
    for row in rows:
        ev = bytes(row['encrypted_value'])
        value = decrypt_value(key, ev) if key else ''
        if not value:
            # Fallback: try DPAPI direct (some WXWork versions use per-cookie DPAPI)
            value = decrypt_value(None, ev)
        if not value:
            continue
        expiry = row['expires_utc']
        expiry_sec = ((expiry / 1_000_000) - 11644473600) if expiry else None
        result.append({
            'name': row['name'],
            'value': value,
            'domain': row['host_key'],
            'path': row['path'],
            'secure': bool(row['is_secure']),
            'httpOnly': bool(row['is_httponly']),
            'expirationDate': expiry_sec,
        })
    return result


def main():
    dbs = find_wxwork_cookie_dbs()
    if not dbs:
        print('[]')
        return

    all_cookies = []
    seen = set()
    for db_path, local_state_path, db_data in dbs:
        for cookie in extract_cookies(db_data, local_state_path, TARGET_DOMAIN):
            key = (cookie['name'], cookie['domain'], cookie['path'])
            if key not in seen:
                seen.add(key)
                all_cookies.append(cookie)

    print(json.dumps(all_cookies))


if __name__ == '__main__':
    main()
