# SysView 🖥️

A modern, glassmorphic Windows resource and memory diagnostics dashboard designed to expose hidden RAM consumption, map Microsoft Edge WebView2 embedded frames, analyze WSL2/virtualization ballooning, and provide safety-classified background process insights.

![SysView Dashboard](https://raw.githubusercontent.com/cbigeagle/SysView/main/docs/screenshot_placeholder.png) *(Note: Add your dashboard screenshot here!)*

---

## ✨ Features

* **📊 Live Memory Allocation Stack**: Mathematically maps active In-Use RAM, Standby File Cache (System Cache), Non-Paged Pool (Driver memory), Paged Pool, and Hardware Reserved memory modules.
* **🌐 Edge WebView2 Instance Grouper**: Groups and identifies opaque `msedgewebview2.exe` sub-processes by their parent applications (e.g. Teams, Outlook, Antigravity IDE). Displays individual tab names, GPU modules, utility tasks, and exact PID profiles.
* **🛡️ Interactive Process Safety Analyzer**: Displays the top background memory hogs with color-coded safety indicators (🟢 Safe to close, 🟡 System service/Caution, 🔴 Critical OS component). Click any row to expand a rich description of what the process does and what happens if you close it.
* **🐳 WSL2 & Hyper-V Ballooning Controller**: Detects active virtual machine instances (`vmmemWSL` / `vmmem`), parses active Linux distributions, warns you if a memory-capping `.wslconfig` is missing, and provides a **one-click shutdown button** to reclaim up to 20GB+ of locked RAM.
* **💡 Diagnostics & Advice Engine**: Dynamically scans your system for memory anomalies (such as kernel driver leaks, memory saturation, or missing caps) and recommends concrete, real-world remedies.

---

## 🛠️ Architecture & Core Mechanics

* **Backend (Go)**: A lightweight, portable Go HTTP server that serves web assets embedded directly in the binary using `go:embed` for zero-dependency execution.
* **Collector (PowerShell)**: A safe collector script (`snapshot.ps1`) that executes locally within standard user privilege bounds (no Administrator required) using WMI queries and process mappings.
* **Frontend (HTML5/CSS3/JS)**: A dark-mode glassmorphic interface powered by Vanilla CSS and raw JavaScript with responsive designs, flex layouts, and smooth animations.

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

Simply execute the compiled binary:

```powershell
.\SysView.exe
```

The server will spin up and start listening in the background:
```text
=========================================
SysView Diagnostics Utility
Server listening on: http://localhost:22880
Press Ctrl+C in this terminal to exit.
=========================================
```

### 3. Open the Dashboard

Open your web browser and navigate to:
**[http://localhost:22880](http://localhost:22880)**

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
