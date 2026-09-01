# SysView 🖥️

A modern, glassmorphic Windows resource and memory diagnostics dashboard designed to expose hidden RAM consumption, map Microsoft Edge WebView2 embedded frames, analyze WSL2/virtualization ballooning, and provide safety-classified background process insights.

![SysView Dashboard](docs/dashboard_screenshot.png)

---

## ✨ Features

* **📊 Live Memory Allocation Stack**: Mathematically maps active In-Use RAM, Standby File Cache (System Cache), Non-Paged Pool (Driver memory), Paged Pool, and Hardware Reserved memory modules.
* **🌐 Edge WebView2 Instance Grouper**: Groups and identifies opaque `msedgewebview2.exe` sub-processes by their parent applications (e.g. Teams, Outlook, Antigravity IDE). Displays individual tab names, GPU modules, utility tasks, and exact PID profiles.
* **🛡️ Interactive Process Safety Analyzer**: Displays the top background memory hogs with color-coded safety indicators (🟢 Safe to close, 🟡 System service/Caution, 🔴 Critical OS component). Click any row to expand a rich description of what the process does and what happens if you close it.
* **🐳 WSL2 & Hyper-V Ballooning Controller**: Detects active virtual machine instances (`vmmemWSL` / `vmmem`), parses active Linux distributions, warns you if a memory-capping `.wslconfig` is missing, and provides a **one-click shutdown button** to reclaim up to 20GB+ of locked RAM.
* **💡 Diagnostics & Advice Engine**: Dynamically scans your system for memory anomalies (such as kernel driver leaks, memory saturation, or missing caps) and recommends concrete, real-world remedies.
* **📈 Bounded History & Redacted Export**: Bounded 15-min history with deltas/sparklines and redacted JSON export for support/triage (auto-refresh 2s/5s/10s, Pause/Resume, per-sample sparklines; export strips CommandLine by default).
---

## 🛠️ Architecture & Core Mechanics

* **Backend (Go)**: A lightweight, portable Go HTTP server that serves web assets embedded directly in the binary using `go:embed` for zero-dependency execution.
* **Collector (PowerShell)**: A safe collector script (`snapshot.ps1`) that executes locally within standard user privilege bounds (no Administrator required) using WMI queries and process mappings.
* **Frontend (HTML5/CSS3/JS)**: A dark-mode glassmorphic interface powered by Vanilla CSS and raw JavaScript with responsive designs, flex layouts, and smooth animations.

---

## 📦 Install

SysView is a **single binary** — no installer, no dependencies, fully **offline** after download. Data never leaves `[IP_ADDRESS]`; the server binds to loopback and requires a per-launch capability token.

### winget (Windows Package Manager)

```powershell
# From winget-pkgs (once published)
winget install SysView.SysView

# Or install directly from this repo's manifest
winget install --manifest winget.yaml
```

Manifest: [`winget.yaml`](winget.yaml) · PackageIdentifier `SysView.SysView` · version `0.2.0` · Scope `user` · portable/x64.

### Scoop

```powershell
# Add bucket (if you publish a bucket) or install from local manifest
scoop install scoop.json

# With a bucket named sysview:
# scoop bucket add sysview https://github.com/SysView/scoop-bucket
# scoop install sysview
```

Manifest: [`scoop.json`](scoop.json) · `64bit` URL placeholder — replace `PLACEHOLDER_SHA256` on release · `bin` → `SysView.exe` · `checkver` tracks GitHub releases.

### Manual — Build from Source

Prerequisites: **Go 1.21+** on Windows.

```powershell
# Clone and build a stripped binary (~6 MB)
git clone https://github.com/SysView/SysView.git
cd SysView
go build -ldflags "-s -w -X main.version=0.2.0 -X main.commit=$(git rev-parse --short HEAD)" -o SysView.exe

# Run (auto-picks 22880, then 22881…)
.\SysView.exe
# Or pin a port
.\SysView.exe -port 8080
```

The binary embeds `static/*` and `snapshot.ps1` — just copy `SysView.exe` anywhere.

> License: [MIT](LICENSE) · See [`LICENSE`](LICENSE) for details.

---

## 🚀 Getting Started

### Prerequisites

To compile SysView, you need to have **Go** installed on your Windows machine:
1. Download and install Go from [golang.org/dl](https://golang.org/dl/).
2. Verify installation:
   ```powershell
   go version
   ```

### 1. Build from Source

Clone the repository, navigate into the directory, and compile the optimized binary:

```powershell
# Compile stripped binary (reducing size to ~6MB)
go build -ldflags "-s -w" -o SysView.exe
```

### 2. Run the Utility

You have two convenient ways to run and manage the diagnostics server:

#### Option A: Use the Desktop Service Manager (Recommended)
We have included a lightweight desktop controller app:
1. Double-click **`SysView.bat`** in your project folder.
2. This opens the dark-themed **SysView Service Manager** window.
3. Configure your desired port (defaults to `22880` and saves to `config.json`), click **Start Server**, and click **Open Web UI** to view the dashboard! You can stop the background process at any time by clicking **Stop Server**.

#### Option B: Run via Command Line
Alternatively, you can start the executable directly from your PowerShell terminal:

```powershell
# Run with default port auto-detection (checks 22880, then 22881, etc.)
.\SysView.exe

# Override and bind to a specific port directly
.\SysView.exe -port 8080
```

---

## 🖥️ Headless / Fleet

Run without the HTTP server or browser — ideal for RMM, Intune, or scheduled collection. Writes the same `envelope` JSON (capturedAt, schemaVersion 3, providers, data) to stdout or a file, with 12s timeout and validation. Redaction is on by default.

```powershell
# Write to stdout (redacted by default), pretty-printed
.\SysView.exe --headless --pretty

# Write to file (default redacted)
.\SysView.exe --headless --output snapshot.json

# Alias for --headless (same behaviour)
.\SysView.exe --once --output snapshot.json

# Pretty + file
.\SysView.exe --headless --pretty --output snapshot.json

# Include secrets (disable redaction) — CommandLine/Command kept verbatim
.\SysView.exe --headless --redact=false --output snapshot.json

# --headless is the same as --once; --once is kept as an alias for fleet scripts
```

Flags:

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--headless` | bool | `false` | Run once, write JSON, exit (no server/browser) |
| `--once` | bool | `false` | Alias for `--headless` |
| `--output` | string | `""` (stdout) | Output file for headless mode |
| `--pretty` | bool | `false` | Pretty-print JSON (`MarshalIndent`) |
| `--redact` | bool | `true` | Redact `AllProcesses[].CommandLine`, `WebViewProcesses[].CommandLine`, `Startup[].Command` → `"[redacted]"` |

Exit codes: `0` on success, `1` on collection/validation/write failure (JSON error to stderr). No HTTP server or browser is started in headless mode.

---

## 💡 Troubleshooting WSL2 Memory Starvation

If your computer is consistently running out of RAM and `vmmemWSL` is consuming upwards of 15GB+:
1. Open the SysView dashboard and check the **WSL2 & Container Virtualization Analyzer** panel.
2. Click **Shut Down WSL & Reclaim Memory** (ensure you have quit **Docker Desktop** first, as it will automatically restart WSL if active).
3. **Cap WSL permanently**:
   * Open your User Profile directory (`Win+R` -> `%USERPROFILE%`).
   * Create a file named `.wslconfig`.
   * Add the following lines to limit WSL's memory consumption (e.g., to 4GB):
     ```ini
     [wsl2]
     memory=4GB
     ```
   * Save the file and restart WSL.

---

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.
