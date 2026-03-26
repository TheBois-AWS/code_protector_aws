# IrisAuth Unified Loader - Maximum Security Edition
# This loader performs all verification in ONE request with maximum protection

import urllib.request
import urllib.parse
import platform
import hashlib
import base64
import uuid
import hmac
import json
import time
import sys
import os

def _irisauth():
  
    # =========================================================================
    # CONTEXT VERIFICATION
    # =========================================================================
    g = globals()
    workspace_key = g.get('_k')  # Workspace/Script ID
    origin = g.get('_o')         # Server origin URL
    license_key = g.get('LicenseKey', g.get('_l', ''))
    
    if not workspace_key or not origin:
        return
    
    # =========================================================================
    # ENHANCED HARDWARE ID GENERATION
    # =========================================================================
    def _generate_hwid():
        components = []
        
        # Component 1: MAC Address (UUID-based)
        try:
            mac = ':'.join(format(x, '02x') for x in uuid.getnode().to_bytes(6, 'big'))
            components.append(mac)
        except:
            pass
        
        # Component 2: Machine name and user
        try:
            components.append(platform.node())
            components.append(os.getlogin())
        except:
            try:
                components.append(os.environ.get('USERNAME', os.environ.get('USER', '')))
            except:
                pass
        
        # Component 3: CPU info
        try:
            components.append(platform.machine())
            components.append(platform.processor())
        except:
            pass
        
        # Component 4: OS info
        try:
            components.append(platform.system())
            components.append(platform.release())
            components.append(platform.version())
        except:
            pass
        
        # Component 5: Disk Serial (Windows)
        if platform.system() == 'Windows':
            try:
                import subprocess
                result = subprocess.run(
                    ['wmic', 'diskdrive', 'get', 'serialnumber'],
                    capture_output=True, text=True, timeout=5,
                    creationflags=0x08000000  # CREATE_NO_WINDOW
                )
                if result.returncode == 0:
                    serial = result.stdout.strip().split('\n')[-1].strip()
                    if serial and serial != 'SerialNumber':
                        components.append(serial)
            except:
                pass
            
            # Component 6: Volume Serial (Windows)
            try:
                import subprocess
                result = subprocess.run(
                    ['cmd', '/c', 'vol', 'c:'],
                    capture_output=True, text=True, timeout=5,
                    creationflags=0x08000000
                )
                if result.returncode == 0:
                    for line in result.stdout.split('\n'):
                        if 'serial' in line.lower():
                            parts = line.split()
                            if parts:
                                components.append(parts[-1])
                            break
            except:
                pass
        
        # Component 7: BIOS UUID (Linux)
        elif platform.system() == 'Linux':
            try:
                with open('/sys/class/dmi/id/product_uuid', 'r') as f:
                    components.append(f.read().strip())
            except:
                pass
            try:
                with open('/etc/machine-id', 'r') as f:
                    components.append(f.read().strip())
            except:
                pass
        
        # Component 8: macOS hardware UUID
        elif platform.system() == 'Darwin':
            try:
                import subprocess
                result = subprocess.run(
                    ['system_profiler', 'SPHardwareDataType'],
                    capture_output=True, text=True, timeout=10
                )
                for line in result.stdout.split('\n'):
                    if 'hardware uuid' in line.lower():
                        components.append(line.split(':')[-1].strip())
                        break
            except:
                pass
        
        # Generate final HWID
        raw = '|'.join(filter(None, components))
        if not raw:
            raw = str(uuid.getnode())
        
        # Double hash for extra security
        hash1 = hashlib.sha256(raw.encode()).hexdigest()
        hash2 = hashlib.sha512((hash1 + raw).encode()).hexdigest()
        return hashlib.sha256(hash2.encode()).hexdigest()[:32]
    
    hwid = _generate_hwid()
    timestamp = int(time.time())
    platform_info = f"{platform.system()} {platform.release()} {platform.machine()}"
    
    # Generate cryptographically secure nonce
    try:
        nonce_bytes = os.urandom(32)
    except:
        nonce_bytes = str(time.time_ns()).encode() + str(os.getpid()).encode()
    nonce = hashlib.sha256(nonce_bytes).hexdigest()[:16]
    
    # =========================================================================
    # SIGNED REQUEST CREATION
    # =========================================================================
    sig_data = f"{workspace_key}:{license_key}:{hwid}:{timestamp}:{nonce}"
    sig_key = hashlib.sha256(f"{nonce}:{workspace_key}".encode()).hexdigest()[:32]
    signature = hmac.new(sig_key.encode(), sig_data.encode(), hashlib.sha256).hexdigest()[:32]
    
    # =========================================================================
    # SECURE NETWORK REQUEST (with User-Agent for validation)
    # =========================================================================
    print("[*] IrisAuth: Verifying...")
    
    params = {
        'id': workspace_key,
        'l': license_key,
        'h': hwid,
        't': timestamp,
        's': signature,
        'n': nonce,
        'p': platform_info
    }
    
    api_url = f"{origin}/api/v5/execute?{urllib.parse.urlencode(params)}"
    
    try:
        # Use default Python User-Agent (urllib) - server validates this
        req = urllib.request.Request(api_url, headers={
            'X-Timestamp': str(timestamp),
            'X-Request-ID': hashlib.md5(f"{nonce}{timestamp}".encode()).hexdigest()[:16]
        })
        
        with urllib.request.urlopen(req, timeout=30) as response:
            raw_data = response.read()
            
            # Verify response content type
            content_type = response.headers.get('Content-Type', '')
            if 'application/json' not in content_type:
                return
            
            data = json.loads(raw_data)
            
            # =========================================================================
            # RESPONSE VERIFICATION
            # =========================================================================
            enc_b64 = data.get('e')  # Encrypted script (base64)
            resp_sig = data.get('s')  # Response signature
            resp_time = data.get('t')  # Response timestamp
            proto_ver = data.get('v', 1)  # Protocol version (2 = binary)
            
            if not all([enc_b64, resp_sig, resp_time]):
                return
            
            # Verify timestamp freshness (5 min tolerance)
            if abs(time.time() - resp_time) > 300:
                print("[!] IrisAuth: Response expired")
                return
            
            # Verify response signature
            verify_key = hashlib.sha256(f"{nonce}:{hwid}".encode()).hexdigest()[:32]
            expected_sig = hmac.new(verify_key.encode(), (enc_b64 + str(resp_time)).encode(), hashlib.sha256).hexdigest()[:32]
            
            if not hmac.compare_digest(resp_sig, expected_sig):
                print("[!] IrisAuth: Verification failed")
                return
            
            # =========================================================================
            # BINARY DECRYPTION & EXECUTION
            # =========================================================================
            encrypted = base64.b64decode(enc_b64)
            
            # Derive decryption key
            decrypt_key = hashlib.sha256(f"{hwid}:{nonce}:{workspace_key}".encode()).hexdigest()[:64].encode()
            
            # XOR decrypt
            decrypted = bytes(b ^ decrypt_key[i % len(decrypt_key)] for i, b in enumerate(encrypted))
            
            # Handle binary format (v2)
            if proto_ver >= 2:
                # Verify magic header
                if len(decrypted) < 16:
                    return
                
                magic = int.from_bytes(decrypted[0:4], 'big')
                if magic != 0x49524953:  # "IRIS"
                    return
                
                # Extract metadata
                orig_len = int.from_bytes(decrypted[4:8], 'big')
                _timestamp = int.from_bytes(decrypted[8:12], 'big')
                _salt = int.from_bytes(decrypted[12:16], 'big')
                
                # Extract script content
                script_bytes = decrypted[16:16 + orig_len]
                
                # Decode to string
                try:
                    decrypted = script_bytes
                except:
                    return
            
            print("[*] IrisAuth: Launching...")
            
            # Execute in isolated namespace with full Python module emulation
            exec_namespace = {
                # Core builtins
                '__builtins__': __builtins__,
                
                # Module-level dunder attributes
                '__name__': '__main__',           # Enable if __name__ == "__main__"
                '__file__': '<protected>',        # Script location (hidden)
                '__doc__': None,                  # Module docstring
                '__package__': None,              # Package name
                '__loader__': None,               # Module loader
                '__spec__': None,                 # Module spec
                '__cached__': None,               # Cached bytecode path
                '__annotations__': {},            # Type annotations
                
                # Additional context
                '__dict__': {},                   # For vars() support
            }
            
            # Copy safe globals (non-internal variables)
            for k, v in g.items():
                if not k.startswith('_') and k not in exec_namespace:
                    exec_namespace[k] = v
            
            # Compile and execute (decrypted is bytes, decode to str)
            script_code = decrypted.decode('utf-8') if isinstance(decrypted, bytes) else decrypted
            compiled = compile(script_code, '<protected>', 'exec')
            exec(compiled, exec_namespace)
            
            # Security: Clear sensitive data from memory
            del encrypted, decrypted, decrypt_key, enc_b64, compiled, script_code
            
    except urllib.error.HTTPError as e:
        try:
            error_content = e.read().decode()
            # Execute error message (for custom error handlers)
            exec(error_content, g)
        except:
            print(f"[!] IrisAuth: Access denied ({e.code})")
    except json.JSONDecodeError:
        print("[!] IrisAuth: Invalid response")
    except Exception as e:
        # Don't reveal specific error details
        print("[!] IrisAuth: Connection error")

# Auto-execute with exception handling
try:
    _irisauth()
except:
    pass
finally:
    # Cleanup: Remove the function from memory
    try:
        del _irisauth
    except:
        pass
