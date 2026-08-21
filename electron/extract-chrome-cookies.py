#!/usr/bin/env python3
"""
Extract Chrome cookies for *.buct.edu.cn and print them as JSON.
Works on Windows using the DPAPI-encrypted AES key stored in Chrome's Local State.
Usage: python extract-chrome-cookies.py
Output: JSON array of {name, value, domain, path, secure, httpOnly, expirationDate}
"""
import os, sys, json, shutil, sqlite3, struct, base64, tempfile

def get_chrome_key():
    local_state_path = os.path.join(
        os.environ.get('LOCALAPPDATA', ''),
        'Google', 'Chrome', 'User Data', 'Local State'
    )
    if not os.path.exists(local_state_path):
        return None
    with open(local_state_path, 'r', encoding='utf-8') as f:
        state = json.load(f)
    encrypted_key_b64 = state.get('os_crypt', {}).get('encrypted_key')
    if not encrypted_key_b64:
        return None
    encrypted_key = base64.b64decode(encrypted_key_b64)
    # Remove DPAPI prefix "DPAPI"
    if encrypted_key[:5] != b'DPAPI':
        return None
    encrypted_key = encrypted_key[5:]
    import ctypes, ctypes.wintypes
    class DATA_BLOB(ctypes.Structure):
        _fields_ = [('cbData', ctypes.wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_char))]
    p = ctypes.create_string_buffer(encrypted_key, len(encrypted_key))
    blobin = DATA_BLOB(ctypes.sizeof(p), p)
    blobout = DATA_BLOB()
    retval = ctypes.windll.crypt32.CryptUnprotectData(
        ctypes.byref(blobin), None, None, None, None, 0, ctypes.byref(blobout)
    )
    if not retval:
        return None
    key = ctypes.string_at(blobout.pbData, blobout.cbData)
    ctypes.windll.kernel32.LocalFree(blobout.pbData)
    return key

def decrypt_value(key, encrypted_value):
    if not encrypted_value:
        return ''
    if encrypted_value[:3] == b'v10' or encrypted_value[:3] == b'v11':
        # AES-256-GCM
        try:
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
            nonce = encrypted_value[3:15]
            ciphertext = encrypted_value[15:]
            aesgcm = AESGCM(key)
            return aesgcm.decrypt(nonce, ciphertext, None).decode('utf-8', errors='replace')
        except Exception:
            return ''
    else:
        # Old DPAPI-per-cookie (pre-Chrome 80)
        try:
            import ctypes, ctypes.wintypes
            class DATA_BLOB(ctypes.Structure):
                _fields_ = [('cbData', ctypes.wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_char))]
            p = ctypes.create_string_buffer(bytes(encrypted_value), len(encrypted_value))
            blobin = DATA_BLOB(ctypes.sizeof(p), p)
            blobout = DATA_BLOB()
            retval = ctypes.windll.crypt32.CryptUnprotectData(
                ctypes.byref(blobin), None, None, None, None, 0, ctypes.byref(blobout)
            )
            if not retval:
                return ''
            val = ctypes.string_at(blobout.pbData, blobout.cbData).decode('utf-8', errors='replace')
            ctypes.windll.kernel32.LocalFree(blobout.pbData)
            return val
        except Exception:
            return ''

def read_locked_file_windows(path):
    """Read a file locked by another process using Win32 shared-access flags."""
    import ctypes, ctypes.wintypes
    GENERIC_READ = 0x80000000
    FILE_SHARE_READ = 0x1
    FILE_SHARE_WRITE = 0x2
    FILE_SHARE_DELETE = 0x4
    OPEN_EXISTING = 3
    INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value
    k32 = ctypes.WinDLL('kernel32', use_last_error=True)
    handle = k32.CreateFileW(
        path, GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        None, OPEN_EXISTING, 0x80, None
    )
    if handle == INVALID_HANDLE_VALUE:
        raise PermissionError(f'CreateFile failed: {ctypes.get_last_error()}')
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

def main():
    cookie_db = os.path.join(
        os.environ.get('LOCALAPPDATA', ''),
        'Google', 'Chrome', 'User Data', 'Default', 'Network', 'Cookies'
    )
    if not os.path.exists(cookie_db):
        # Try old path
        cookie_db = os.path.join(
            os.environ.get('LOCALAPPDATA', ''),
            'Google', 'Chrome', 'User Data', 'Default', 'Cookies'
        )
    if not os.path.exists(cookie_db):
        print('[]'); return

    key = get_chrome_key()

    # Copy to temp (Chrome locks the original)
    # Read cookie DB while Chrome is running using Win32 shared-access flags
    tmp = tempfile.mktemp(suffix='.db')
    try:
        data = read_locked_file_windows(cookie_db)
        with open(tmp, 'wb') as f:
            f.write(data)
        con = sqlite3.connect(tmp)
    except Exception:
        print('[]'); return
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute(
            "SELECT name, encrypted_value, host_key, path, is_secure, is_httponly, expires_utc "
            "FROM cookies WHERE host_key LIKE '%buct.edu.cn'"
        ).fetchall()
    finally:
        con.close()
        try: os.unlink(tmp)
        except: pass

    result = []
    for row in rows:
        value = ''
        if key:
            value = decrypt_value(key, bytes(row['encrypted_value']))
        if not value:
            continue
        expiry = row['expires_utc']
        # Chrome epoch: microseconds since 1601-01-01; JS/Electron: seconds since 1970-01-01
        if expiry:
            expiry_sec = (expiry / 1_000_000) - 11644473600
        else:
            expiry_sec = None
        result.append({
            'name': row['name'],
            'value': value,
            'domain': row['host_key'],
            'path': row['path'],
            'secure': bool(row['is_secure']),
            'httpOnly': bool(row['is_httponly']),
            'expirationDate': expiry_sec,
        })

    print(json.dumps(result))

if __name__ == '__main__':
    main()
