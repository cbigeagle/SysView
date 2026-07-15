package main

import (
	"bytes"
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os/exec"
	"runtime"
	"strconv"
)

//go:embed static/*
var staticFiles embed.FS

//go:embed snapshot.ps1
var snapshotScript string

const defaultPort = 22880

func main() {
	// Parse CLI flags
	portFlag := flag.Int("port", 0, "Explicit port to run the server on (overrides auto-detection)")
	flag.Parse()

	var port int
	if *portFlag > 0 {
		// Verify if the requested port is free
		ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *portFlag))
		if err != nil {
			log.Fatalf("Port %d is already in use. Please select a different port.", *portFlag)
		}
		ln.Close()
		port = *portFlag
	} else {
		// Find an available port starting at defaultPort
		port = findAvailablePort(defaultPort)
	}

	addr := fmt.Sprintf("127.0.0.1:%d", port)

	// Get FS for static folder
	staticFS, err := fs.Sub(staticFiles, "static")
	if err != nil {
		log.Fatalf("Error sub-embedding static files: %v", err)
	}

	// Register Handlers
	http.Handle("/", http.FileServer(http.FS(staticFS)))
	http.HandleFunc("/api/snapshot", handleSnapshot)
	http.HandleFunc("/api/wsl/shutdown", handleWslShutdown)

	// Start server in background
	serverUrl := fmt.Sprintf("http://localhost:%d", port)
	fmt.Printf("=========================================\n")
	fmt.Printf("SysView Diagnostics Utility\n")
	fmt.Printf("Server listening on: %s\n", serverUrl)
	fmt.Printf("Press Ctrl+C in this terminal to exit.\n")
	fmt.Printf("=========================================\n")

	go func() {
		err := http.ListenAndServe(addr, nil)
		if err != nil {
			log.Fatalf("Failed to start HTTP server: %v", err)
		}
	}()

	// Open user browser
	openBrowser(serverUrl)

	// Block main thread (keep app running)
	select {}
}

// Handler for API snapshot request
func handleSnapshot(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")

	// Execute PowerShell script via stdin
	cmd := exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "-")
	cmd.Stdin = bytes.NewReader([]byte(snapshotScript))

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		log.Printf("PowerShell Execution Error: %v\nStderr: %s\n", err, stderr.String())
		http.Error(w, fmt.Sprintf(`{"error": "PowerShell collection failed", "details": %q}`, stderr.String()), http.StatusInternalServerError)
		return
	}

	// Write output directly to response writer
	_, err = w.Write(stdout.Bytes())
	if err != nil {
		log.Printf("Error writing API response: %v\n", err)
	}
}

// Find first available TCP port starting from startPort
func findAvailablePort(startPort int) int {
	for port := startPort; port < startPort+100; port++ {
		ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err == nil {
			ln.Close()
			return port
		}
	}
	// Fallback to random dynamic port
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return startPort
	}
	defer ln.Close()
	_, portStr, _ := net.SplitHostPort(ln.Addr().String())
	p, _ := strconv.Atoi(portStr)
	return p
}

// Open the default browser to a URL on Windows
func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default: // Linux/BSD
		cmd = exec.Command("xdg-open", url)
	}
	
	err := cmd.Start()
	if err != nil {
		fmt.Printf("Failed to open browser automatically: %v\n", err)
		fmt.Printf("Please open your browser manually and navigate to: %s\n", url)
	}
}

// Handler to release WSL memory by shutting down WSL VM
func handleWslShutdown(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed. Use POST."}`, http.StatusMethodNotAllowed)
		return
	}

	log.Println("Received request to shutdown WSL...")
	cmd := exec.Command("wsl.exe", "--shutdown")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	
	err := cmd.Run()
	if err != nil {
		log.Printf("Error running wsl --shutdown: %v, stderr: %s\n", err, stderr.String())
		http.Error(w, fmt.Sprintf(`{"error": "Failed to shutdown WSL", "details": %q}`, stderr.String()), http.StatusInternalServerError)
		return
	}

	log.Println("WSL VM successfully shut down.")
	w.Write([]byte(`{"status": "success", "message": "WSL VM successfully shut down and memory released."}`))
}
