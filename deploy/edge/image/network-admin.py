#!/usr/bin/env python3
"""
SafeSchool Edge -- Network Administration Web UI
=================================================
Single-file Python3 web server for configuring network settings on the edge
mini PC. Runs on port 9090 and provides a browser-based UI for IT staff to
set static IP, gateway, DNS, hostname, and view service status.

No external dependencies -- uses only Python 3 stdlib (ships with Ubuntu 24.04).

Managed by: safeschool-network-admin.service (systemd)
"""

import http.server
import json
import os
import re
import secrets
import socket
import subprocess
import sys
import time
import ipaddress
import hashlib
import logging
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from urllib.parse import parse_qs
from threading import Lock

# -- Configuration ------------------------------------------------------------
LISTEN_PORT = 9090
TOKEN_FILE = "/etc/safeschool/admin-token"
LOG_FILE = "/var/log/safeschool/network-admin.log"
NETPLAN_DIR = "/etc/netplan"
NETPLAN_FILE = f"{NETPLAN_DIR}/99-safeschool-static.yaml"
SESSION_TIMEOUT = 3600  # 1 hour

# -- Logging ------------------------------------------------------------------
os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
logging.basicConfig(
    filename=LOG_FILE,
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
log = logging.getLogger("network-admin")

# -- Rate Limiting ------------------------------------------------------------
_rate_lock = Lock()
_rate_map: dict[str, list[float]] = {}
RATE_LIMIT = 5       # max POST requests
RATE_WINDOW = 60     # per 60 seconds


def check_rate_limit(ip: str) -> bool:
    now = time.time()
    with _rate_lock:
        hits = _rate_map.setdefault(ip, [])
        hits[:] = [t for t in hits if now - t < RATE_WINDOW]
        if len(hits) >= RATE_LIMIT:
            return False
        hits.append(now)
        return True


# -- Sessions -----------------------------------------------------------------
_sessions: dict[str, float] = {}


def create_session() -> str:
    sid = secrets.token_hex(24)
    _sessions[sid] = time.time()
    return sid


def valid_session(sid: str) -> bool:
    ts = _sessions.get(sid)
    if ts is None:
        return False
    if time.time() - ts > SESSION_TIMEOUT:
        _sessions.pop(sid, None)
        return False
    _sessions[sid] = time.time()  # refresh
    return True


# -- Admin Token --------------------------------------------------------------
def get_admin_token() -> str:
    try:
        return open(TOKEN_FILE).read().strip()
    except FileNotFoundError:
        return ""


# -- Network helpers ----------------------------------------------------------
def get_default_interface() -> str:
    """Return the name of the interface that has the default route."""
    try:
        out = subprocess.check_output(
            ["ip", "-j", "route", "show", "default"], text=True, timeout=5
        )
        routes = json.loads(out)
        if routes:
            return routes[0].get("dev", "")
    except Exception:
        pass
    # Fallback: first non-lo interface
    try:
        out = subprocess.check_output(
            ["ip", "-j", "link", "show"], text=True, timeout=5
        )
        links = json.loads(out)
        for link in links:
            name = link.get("ifname", "")
            if name != "lo" and link.get("operstate") == "UP":
                return name
    except Exception:
        pass
    return ""


def get_network_info() -> dict:
    iface = get_default_interface()
    info: dict = {
        "interface": iface,
        "ip": "",
        "cidr": "",
        "gateway": "",
        "dns": [],
        "mac": "",
        "hostname": socket.gethostname(),
        "dhcp": False,
    }

    if not iface:
        return info

    # IP + CIDR
    try:
        out = subprocess.check_output(
            ["ip", "-j", "addr", "show", iface], text=True, timeout=5
        )
        data = json.loads(out)
        if data:
            for addr_info in data[0].get("addr_info", []):
                if addr_info.get("family") == "inet":
                    info["ip"] = addr_info.get("local", "")
                    info["cidr"] = str(addr_info.get("prefixlen", "24"))
                    break
            info["mac"] = data[0].get("address", "")
    except Exception:
        pass

    # Gateway
    try:
        out = subprocess.check_output(
            ["ip", "-j", "route", "show", "default"], text=True, timeout=5
        )
        routes = json.loads(out)
        if routes:
            info["gateway"] = routes[0].get("gateway", "")
    except Exception:
        pass

    # DNS
    try:
        lines = open("/etc/resolv.conf").readlines()
        info["dns"] = [
            l.split()[1] for l in lines
            if l.strip().startswith("nameserver") and len(l.split()) > 1
        ]
    except Exception:
        pass

    # DHCP detection: check if active netplan uses dhcp4
    try:
        for fname in sorted(os.listdir(NETPLAN_DIR)):
            if fname.endswith(".yaml") or fname.endswith(".yml"):
                content = open(os.path.join(NETPLAN_DIR, fname)).read()
                if "dhcp4: true" in content or "dhcp4: yes" in content:
                    info["dhcp"] = True
                    break
    except Exception:
        pass

    return info


def get_system_info() -> dict:
    info: dict = {"hostname": socket.gethostname(), "uptime": "", "disk": "", "memory": "", "cpu_load": ""}

    try:
        info["uptime"] = subprocess.check_output(["uptime", "-p"], text=True, timeout=5).strip()
    except Exception:
        pass

    try:
        out = subprocess.check_output(["df", "-h", "/"], text=True, timeout=5)
        parts = out.strip().split("\n")[-1].split()
        if len(parts) >= 5:
            info["disk"] = f"{parts[2]} / {parts[1]} ({parts[4]} used)"
    except Exception:
        pass

    try:
        out = subprocess.check_output(["free", "-h"], text=True, timeout=5)
        for line in out.split("\n"):
            if line.startswith("Mem:"):
                parts = line.split()
                if len(parts) >= 4:
                    info["memory"] = f"{parts[2]} / {parts[1]} ({parts[3]} free)"
    except Exception:
        pass

    try:
        load = open("/proc/loadavg").read().split()[:3]
        info["cpu_load"] = " ".join(load)
    except Exception:
        pass

    return info


def get_services_info() -> list[dict]:
    services = []
    try:
        out = subprocess.check_output(
            ["docker", "compose", "-f", "/opt/safeschool/deploy/edge/docker-compose.yml",
             "--env-file", "/opt/safeschool/deploy/edge/.env",
             "ps", "--format", "json"],
            text=True, timeout=15, stderr=subprocess.DEVNULL,
        )
        for line in out.strip().split("\n"):
            if not line.strip():
                continue
            try:
                svc = json.loads(line)
                services.append({
                    "name": svc.get("Service", svc.get("Name", "unknown")),
                    "status": svc.get("Status", svc.get("State", "unknown")),
                    "state": svc.get("State", ""),
                })
            except json.JSONDecodeError:
                pass
    except Exception:
        pass
    return services


def apply_network_config(
    ip: str, cidr: str, gateway: str, dns1: str, dns2: str,
    hostname: str, dhcp: bool, iface: str
) -> tuple[bool, str]:
    """Write netplan config and schedule apply with 2-second delay."""

    # Validate inputs
    try:
        if not dhcp:
            ipaddress.ip_address(ip)
            ipaddress.ip_address(gateway)
            cidr_int = int(cidr)
            if cidr_int < 1 or cidr_int > 32:
                return False, "CIDR must be between 1 and 32"
            ipaddress.ip_network(f"{ip}/{cidr}", strict=False)
        if dns1:
            ipaddress.ip_address(dns1)
        if dns2:
            ipaddress.ip_address(dns2)
    except ValueError as e:
        return False, f"Invalid IP address: {e}"

    if hostname:
        if not re.match(r"^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?$", hostname):
            return False, "Invalid hostname"

    if not iface:
        iface = get_default_interface()
    if not iface:
        return False, "No network interface found"

    # Build netplan YAML
    dns_list = [d for d in [dns1, dns2] if d]

    if dhcp:
        netplan = f"""# SafeSchool Edge -- Network Configuration (managed by network-admin)
# Last modified: {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}
network:
  version: 2
  ethernets:
    {iface}:
      dhcp4: true
      dhcp6: false
"""
    else:
        dns_str = ", ".join(dns_list) if dns_list else "8.8.8.8, 1.1.1.1"
        netplan = f"""# SafeSchool Edge -- Network Configuration (managed by network-admin)
# Last modified: {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}
network:
  version: 2
  ethernets:
    {iface}:
      dhcp4: false
      dhcp6: false
      addresses:
        - {ip}/{cidr}
      routes:
        - to: default
          via: {gateway}
      nameservers:
        addresses: [{dns_str}]
"""

    # Remove any installer-generated DHCP configs
    try:
        for fname in os.listdir(NETPLAN_DIR):
            fpath = os.path.join(NETPLAN_DIR, fname)
            if fname != "99-safeschool-static.yaml" and (fname.endswith(".yaml") or fname.endswith(".yml")):
                os.remove(fpath)
                log.info("Removed old netplan config: %s", fname)
    except Exception as e:
        log.warning("Could not clean old netplan configs: %s", e)

    # Write new config
    try:
        os.makedirs(NETPLAN_DIR, exist_ok=True)
        with open(NETPLAN_FILE, "w") as f:
            f.write(netplan)
        os.chmod(NETPLAN_FILE, 0o600)
        log.info("Wrote netplan config: %s", NETPLAN_FILE)
    except Exception as e:
        return False, f"Failed to write netplan: {e}"

    # Set hostname if provided
    if hostname:
        try:
            subprocess.run(
                ["hostnamectl", "set-hostname", hostname],
                check=True, timeout=10,
            )
            log.info("Hostname set to: %s", hostname)
        except Exception as e:
            log.warning("Failed to set hostname: %s", e)

    # Apply netplan after a delay so the HTTP response can be sent first
    new_ip = ip if not dhcp else None
    subprocess.Popen(
        ["bash", "-c", "sleep 2 && netplan apply"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    log.info("Scheduled netplan apply (2s delay). DHCP=%s IP=%s", dhcp, ip)

    return True, new_ip or "dhcp"


# -- HTML Template -----------------------------------------------------------
HTML_PAGE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SafeSchool Edge - Network Admin</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0f172a;--card:#1e293b;--border:#334155;--text:#e2e8f0;--muted:#94a3b8;
--accent:#3b82f6;--accent-hover:#2563eb;--green:#22c55e;--yellow:#eab308;--red:#ef4444;
--radius:8px}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
background:var(--bg);color:var(--text);min-height:100vh}
a{color:var(--accent)}
.container{max-width:960px;margin:0 auto;padding:24px 16px}
header{display:flex;align-items:center;gap:12px;margin-bottom:32px;padding-bottom:16px;border-bottom:1px solid var(--border)}
header h1{font-size:1.5rem;font-weight:700}
header .badge{font-size:.75rem;padding:2px 8px;border-radius:12px;background:var(--accent);color:#fff;font-weight:600}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
@media(max-width:700px){.grid{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:20px}
.card h2{font-size:1rem;font-weight:600;margin-bottom:16px;color:var(--accent)}
.field{margin-bottom:12px}
.field label{display:block;font-size:.8rem;color:var(--muted);margin-bottom:4px;font-weight:500}
.field .val{font-family:'SF Mono',SFMono-Regular,Consolas,monospace;font-size:.9rem}
.form-group{margin-bottom:14px}
.form-group label{display:block;font-size:.8rem;color:var(--muted);margin-bottom:4px;font-weight:500}
.form-group input,.form-group select{width:100%;padding:8px 12px;border:1px solid var(--border);
border-radius:var(--radius);background:#0f172a;color:var(--text);font-size:.9rem;font-family:inherit}
.form-group input:focus,.form-group select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 2px rgba(59,130,246,.25)}
.toggle{display:flex;align-items:center;gap:8px;cursor:pointer}
.toggle input{display:none}
.toggle .slider{width:44px;height:24px;background:var(--border);border-radius:12px;position:relative;transition:.2s}
.toggle .slider::after{content:'';position:absolute;width:18px;height:18px;border-radius:50%;background:#fff;top:3px;left:3px;transition:.2s}
.toggle input:checked+.slider{background:var(--accent)}
.toggle input:checked+.slider::after{left:23px}
.btn{display:inline-flex;align-items:center;gap:6px;padding:10px 20px;border:none;border-radius:var(--radius);
font-size:.9rem;font-weight:600;cursor:pointer;transition:.15s}
.btn-primary{background:var(--accent);color:#fff}
.btn-primary:hover{background:var(--accent-hover)}
.btn-primary:disabled{opacity:.5;cursor:not-allowed}
.svc-row{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:.85rem}
.svc-dot{width:8px;height:8px;border-radius:50%}
.svc-dot.up{background:var(--green)}.svc-dot.starting{background:var(--yellow)}.svc-dot.down{background:var(--red)}
.svc-name{font-weight:600;width:100px}.svc-status{color:var(--muted);font-size:.8rem}
.alert{padding:12px 16px;border-radius:var(--radius);margin-bottom:16px;font-size:.85rem}
.alert-success{background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.3);color:var(--green)}
.alert-error{background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);color:var(--red)}
.alert-info{background:rgba(59,130,246,.15);border:1px solid rgba(59,130,246,.3);color:var(--accent)}
.hidden{display:none}
/* Login */
.login-wrap{display:flex;align-items:center;justify-content:center;min-height:100vh}
.login-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:40px;width:100%;max-width:400px;text-align:center}
.login-card h1{font-size:1.5rem;margin-bottom:8px}
.login-card p{color:var(--muted);font-size:.85rem;margin-bottom:24px}
.login-card input{width:100%;padding:10px 14px;border:1px solid var(--border);border-radius:var(--radius);
background:#0f172a;color:var(--text);font-size:1rem;margin-bottom:16px;text-align:center;letter-spacing:2px}
.login-card .btn{width:100%}
.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>

<!-- Login Screen -->
<div id="loginScreen" class="login-wrap">
  <div class="login-card">
    <h1>SafeSchool Edge</h1>
    <p>Enter the admin token displayed on the device console</p>
    <div id="loginError" class="alert alert-error hidden"></div>
    <input type="text" id="tokenInput" placeholder="Admin Token" autocomplete="off" autofocus>
    <button class="btn btn-primary" onclick="doLogin()">Authenticate</button>
  </div>
</div>

<!-- Main Dashboard -->
<div id="dashboard" class="hidden">
  <div class="container">
    <header>
      <h1>SafeSchool Edge</h1>
      <span class="badge">Network Admin</span>
    </header>

    <div id="alertArea"></div>

    <div class="grid">
      <!-- Current Network Status -->
      <div class="card">
        <h2>Current Network</h2>
        <div class="field"><label>Interface</label><div class="val" id="curIface">--</div></div>
        <div class="field"><label>IP Address</label><div class="val" id="curIP">--</div></div>
        <div class="field"><label>Subnet</label><div class="val" id="curCIDR">--</div></div>
        <div class="field"><label>Gateway</label><div class="val" id="curGW">--</div></div>
        <div class="field"><label>DNS</label><div class="val" id="curDNS">--</div></div>
        <div class="field"><label>MAC Address</label><div class="val" id="curMAC">--</div></div>
        <div class="field"><label>Mode</label><div class="val" id="curMode">--</div></div>
      </div>

      <!-- Network Configuration Form -->
      <div class="card">
        <h2>Network Settings</h2>
        <form id="netForm" onsubmit="return applyNetwork(event)">
          <div class="form-group">
            <label class="toggle">
              <input type="checkbox" id="dhcpToggle" onchange="toggleDHCP()">
              <span class="slider"></span>
              <span>Use DHCP</span>
            </label>
          </div>
          <div id="staticFields">
            <div class="form-group">
              <label>IP Address</label>
              <input type="text" id="fIP" placeholder="192.168.0.250" required pattern="^(\d{1,3}\.){3}\d{1,3}$">
            </div>
            <div class="form-group">
              <label>CIDR (Subnet Prefix)</label>
              <input type="number" id="fCIDR" value="24" min="1" max="32" required>
            </div>
            <div class="form-group">
              <label>Gateway</label>
              <input type="text" id="fGW" placeholder="192.168.0.1" required pattern="^(\d{1,3}\.){3}\d{1,3}$">
            </div>
            <div class="form-group">
              <label>DNS Primary</label>
              <input type="text" id="fDNS1" placeholder="8.8.8.8" pattern="^(\d{1,3}\.){3}\d{1,3}$">
            </div>
            <div class="form-group">
              <label>DNS Secondary</label>
              <input type="text" id="fDNS2" placeholder="1.1.1.1" pattern="^(\d{1,3}\.){3}\d{1,3}$">
            </div>
          </div>
          <div class="form-group">
            <label>Hostname</label>
            <input type="text" id="fHostname" placeholder="safeschool-edge" pattern="^[a-zA-Z0-9][a-zA-Z0-9\-]{0,61}[a-zA-Z0-9]?$">
          </div>
          <button type="submit" class="btn btn-primary" id="applyBtn">Apply Settings</button>
        </form>
      </div>

      <!-- System Info -->
      <div class="card">
        <h2>System Info</h2>
        <div class="field"><label>Hostname</label><div class="val" id="sysHost">--</div></div>
        <div class="field"><label>Uptime</label><div class="val" id="sysUptime">--</div></div>
        <div class="field"><label>CPU Load</label><div class="val" id="sysCPU">--</div></div>
        <div class="field"><label>Memory</label><div class="val" id="sysMem">--</div></div>
        <div class="field"><label>Disk</label><div class="val" id="sysDisk">--</div></div>
      </div>

      <!-- Docker Services -->
      <div class="card">
        <h2>Services</h2>
        <div id="svcList"><p style="color:var(--muted);font-size:.85rem">Loading...</p></div>
      </div>
    </div>
  </div>
</div>

<script>
const API = '';
let pollTimer = null;

async function doLogin() {
  const token = document.getElementById('tokenInput').value.trim();
  if (!token) return;
  try {
    const r = await fetch(API + '/api/auth', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({token}),
    });
    const d = await r.json();
    if (d.ok) {
      document.getElementById('loginScreen').classList.add('hidden');
      document.getElementById('dashboard').classList.remove('hidden');
      loadAll();
      pollTimer = setInterval(loadAll, 15000);
    } else {
      const el = document.getElementById('loginError');
      el.textContent = d.error || 'Invalid token';
      el.classList.remove('hidden');
    }
  } catch(e) {
    const el = document.getElementById('loginError');
    el.textContent = 'Connection error';
    el.classList.remove('hidden');
  }
}

document.getElementById('tokenInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});

function toggleDHCP() {
  const checked = document.getElementById('dhcpToggle').checked;
  document.getElementById('staticFields').style.display = checked ? 'none' : 'block';
  document.querySelectorAll('#staticFields input').forEach(i => i.required = !checked);
}

async function loadAll() {
  try {
    const [net, sys, svc] = await Promise.all([
      fetch(API + '/api/network').then(r => r.json()),
      fetch(API + '/api/system').then(r => r.json()),
      fetch(API + '/api/services').then(r => r.json()),
    ]);
    // Network
    document.getElementById('curIface').textContent = net.interface || '--';
    document.getElementById('curIP').textContent = net.ip || '--';
    document.getElementById('curCIDR').textContent = net.cidr ? '/' + net.cidr : '--';
    document.getElementById('curGW').textContent = net.gateway || '--';
    document.getElementById('curDNS').textContent = (net.dns || []).join(', ') || '--';
    document.getElementById('curMAC').textContent = net.mac || '--';
    document.getElementById('curMode').textContent = net.dhcp ? 'DHCP' : 'Static';
    // Pre-fill form
    if (net.ip) document.getElementById('fIP').value = net.ip;
    if (net.cidr) document.getElementById('fCIDR').value = net.cidr;
    if (net.gateway) document.getElementById('fGW').value = net.gateway;
    if (net.dns && net.dns[0]) document.getElementById('fDNS1').value = net.dns[0];
    if (net.dns && net.dns[1]) document.getElementById('fDNS2').value = net.dns[1];
    if (net.hostname) document.getElementById('fHostname').value = net.hostname;
    document.getElementById('dhcpToggle').checked = net.dhcp;
    toggleDHCP();
    // System
    document.getElementById('sysHost').textContent = sys.hostname || '--';
    document.getElementById('sysUptime').textContent = sys.uptime || '--';
    document.getElementById('sysCPU').textContent = sys.cpu_load || '--';
    document.getElementById('sysMem').textContent = sys.memory || '--';
    document.getElementById('sysDisk').textContent = sys.disk || '--';
    // Services
    const sl = document.getElementById('svcList');
    if (svc.length === 0) {
      sl.innerHTML = '<p style="color:var(--muted);font-size:.85rem">No services detected</p>';
    } else {
      sl.innerHTML = svc.map(s => {
        const st = (s.status || s.state || '').toLowerCase();
        const cls = st.includes('healthy') ? 'up' : st.includes('up') || st.includes('running') ? 'starting' : 'down';
        return `<div class="svc-row"><span class="svc-dot ${cls}"></span><span class="svc-name">${esc(s.name)}</span><span class="svc-status">${esc(s.status)}</span></div>`;
      }).join('');
    }
  } catch(e) {
    console.error('Poll error:', e);
  }
}

async function applyNetwork(e) {
  e.preventDefault();
  const btn = document.getElementById('applyBtn');
  btn.disabled = true;
  btn.textContent = 'Applying...';

  const dhcp = document.getElementById('dhcpToggle').checked;
  const body = {
    dhcp,
    ip: document.getElementById('fIP').value.trim(),
    cidr: document.getElementById('fCIDR').value.trim(),
    gateway: document.getElementById('fGW').value.trim(),
    dns1: document.getElementById('fDNS1').value.trim(),
    dns2: document.getElementById('fDNS2').value.trim(),
    hostname: document.getElementById('fHostname').value.trim(),
  };

  try {
    const r = await fetch(API + '/api/network', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (d.ok) {
      const newIP = d.new_ip;
      let msg = 'Network settings applied successfully.';
      if (newIP && newIP !== 'dhcp' && newIP !== body.ip) {
        msg += ' Redirecting to new IP...';
      }
      showAlert('success', msg);

      // If IP changed, redirect after a delay
      if (!dhcp && newIP && newIP !== window.location.hostname) {
        setTimeout(() => {
          window.location.href = 'http://' + newIP + ':' + LISTEN_PORT;
        }, 4000);
      } else {
        setTimeout(loadAll, 3000);
      }
    } else {
      showAlert('error', d.error || 'Failed to apply settings');
    }
  } catch(e) {
    showAlert('error', 'Connection lost -- the IP may have changed. Try the new address.');
  }

  btn.disabled = false;
  btn.textContent = 'Apply Settings';
}

const LISTEN_PORT = 9090;

function showAlert(type, msg) {
  const area = document.getElementById('alertArea');
  const el = document.createElement('div');
  el.className = 'alert alert-' + type;
  el.textContent = msg;
  area.prepend(el);
  setTimeout(() => el.remove(), 10000);
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// Check if already authenticated (cookie)
fetch(API + '/api/network').then(r => {
  if (r.ok) {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    loadAll();
    pollTimer = setInterval(loadAll, 15000);
  }
}).catch(() => {});
</script>
</body>
</html>"""


# -- HTTP Handler -------------------------------------------------------------
class NetworkAdminHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        log.info("%s %s", self.address_string(), fmt % args)

    def _get_session(self) -> str:
        cookie_header = self.headers.get("Cookie", "")
        c = SimpleCookie()
        try:
            c.load(cookie_header)
        except Exception:
            return ""
        morsel = c.get("session")
        return morsel.value if morsel else ""

    def _is_authed(self) -> bool:
        return valid_session(self._get_session())

    def _send_json(self, data: dict, status: int = 200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, html: str, status: int = 200):
        body = html.encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length", 0))
        if length > 65536:
            return b""
        return self.rfile.read(length)

    def do_GET(self):
        path = self.path.split("?")[0]

        if path == "/":
            self._send_html(HTML_PAGE)
            return

        # All API endpoints require auth
        if not self._is_authed():
            self._send_json({"error": "Unauthorized"}, 401)
            return

        if path == "/api/network":
            self._send_json(get_network_info())
        elif path == "/api/system":
            self._send_json(get_system_info())
        elif path == "/api/services":
            self._send_json(get_services_info())
        else:
            self._send_json({"error": "Not found"}, 404)

    def do_POST(self):
        client_ip = self.client_address[0]
        if not check_rate_limit(client_ip):
            log.warning("Rate limit exceeded for %s", client_ip)
            self._send_json({"error": "Too many requests. Try again later."}, 429)
            return

        path = self.path.split("?")[0]

        if path == "/api/auth":
            try:
                data = json.loads(self._read_body())
            except (json.JSONDecodeError, ValueError):
                self._send_json({"error": "Invalid request"}, 400)
                return

            token = data.get("token", "").strip()
            expected = get_admin_token()
            if not expected:
                self._send_json({"error": "Admin token not configured on this device"}, 500)
                return

            if not secrets.compare_digest(token, expected):
                log.warning("Failed auth attempt from %s", client_ip)
                self._send_json({"error": "Invalid admin token"}, 401)
                return

            sid = create_session()
            log.info("Successful auth from %s", client_ip)

            body = json.dumps({"ok": True}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header(
                "Set-Cookie",
                f"session={sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_TIMEOUT}",
            )
            self.end_headers()
            self.wfile.write(body)
            return

        # All other POST endpoints require auth
        if not self._is_authed():
            self._send_json({"error": "Unauthorized"}, 401)
            return

        if path == "/api/network":
            try:
                data = json.loads(self._read_body())
            except (json.JSONDecodeError, ValueError):
                self._send_json({"error": "Invalid request"}, 400)
                return

            dhcp = data.get("dhcp", False)
            ip_addr = data.get("ip", "")
            cidr = data.get("cidr", "24")
            gateway = data.get("gateway", "")
            dns1 = data.get("dns1", "")
            dns2 = data.get("dns2", "")
            hostname = data.get("hostname", "")

            success, result = apply_network_config(
                ip_addr, str(cidr), gateway, dns1, dns2,
                hostname, dhcp, get_default_interface(),
            )

            if success:
                self._send_json({"ok": True, "new_ip": result})
            else:
                self._send_json({"ok": False, "error": result}, 400)

        elif path == "/api/hostname":
            try:
                data = json.loads(self._read_body())
            except (json.JSONDecodeError, ValueError):
                self._send_json({"error": "Invalid request"}, 400)
                return

            hostname = data.get("hostname", "").strip()
            if not hostname or not re.match(r"^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?$", hostname):
                self._send_json({"error": "Invalid hostname"}, 400)
                return

            try:
                subprocess.run(
                    ["hostnamectl", "set-hostname", hostname],
                    check=True, timeout=10,
                )
                log.info("Hostname changed to %s by %s", hostname, client_ip)
                self._send_json({"ok": True, "hostname": hostname})
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
        else:
            self._send_json({"error": "Not found"}, 404)


# -- Main --------------------------------------------------------------------
def main():
    port = int(os.environ.get("NETWORK_ADMIN_PORT", LISTEN_PORT))

    server = http.server.HTTPServer(("0.0.0.0", port), NetworkAdminHandler)
    log.info("SafeSchool Network Admin starting on port %d", port)
    print(f"SafeSchool Network Admin listening on http://0.0.0.0:{port}")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Shutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
