package main

import (
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestBridgeScanFindsGcodeOnlyAndReadsInsideFolder(t *testing.T) {
	a := testApp(t)
	dir := t.TempDir()
	sub := filepath.Join(dir, "salida")
	if e := os.Mkdir(sub, 0755); e != nil {
		t.Fatal(e)
	}
	old := filepath.Join(dir, "viejo.gcode")
	fresh := filepath.Join(sub, "pieza.gco")
	os.WriteFile(old, []byte(";TIME:60\n"), 0644)
	os.WriteFile(filepath.Join(dir, "notas.txt"), []byte("no"), 0644)
	os.WriteFile(fresh, []byte(";TIME:120\n"), 0644)
	now := time.Now()
	os.Chtimes(old, now.Add(-time.Hour), now.Add(-time.Hour))

	w := call(a, "POST", "/api/bridge/scan", `{"folder":`+quote(dir)+`}`)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var scan struct {
		Folder string   `json:"folder"`
		Files  []object `json:"files"`
	}
	if e := json.Unmarshal(w.Body.Bytes(), &scan); e != nil {
		t.Fatal(e)
	}
	if len(scan.Files) != 2 {
		t.Fatal(scan.Files)
	}
	if scan.Files[0]["name"] != "pieza.gco" || scan.Files[0]["rel"] != "salida/pieza.gco" {
		t.Fatal(scan.Files[0])
	}
	w = call(a, "GET", "/api/bridge/file?path="+url.QueryEscape(fresh), "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), ";TIME:120") {
		t.Fatal(w.Code, w.Body.String())
	}
	w = call(a, "GET", "/api/bridge/file?path="+url.QueryEscape(filepath.Join(dir, "notas.txt")), "")
	if w.Code != 403 {
		t.Fatal("non-gcode accepted", w.Code)
	}
	w = call(a, "GET", "/api/bridge/file?path="+url.QueryEscape(filepath.Join(dir, "..", "fuera.gcode")), "")
	if w.Code == 200 {
		t.Fatal("path outside bridge accepted")
	}
}

func TestBridgeRejectsInvalidFoldersAndGcodeLimits(t *testing.T) {
	a := testApp(t)
	if _, e := bridgeDir(""); e == nil {
		t.Fatal("empty folder accepted")
	}
	if _, e := bridgeDir(filepath.Join(t.TempDir(), "missing")); e == nil {
		t.Fatal("missing folder accepted")
	}
	file := filepath.Join(t.TempDir(), "archivo.txt")
	os.WriteFile(file, []byte("x"), 0644)
	if _, e := bridgeDir(file); e == nil {
		t.Fatal("file accepted as folder")
	}
	if _, e := bridgeInside(t.TempDir(), "/etc/passwd"); e == nil {
		t.Fatal("absolute escape accepted")
	}
	dir := t.TempDir()
	w := call(a, "POST", "/api/bridge/scan", `{"folder":`+quote(dir)+`}`)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	w = call(a, "GET", "/api/bridge/file?path="+url.QueryEscape(filepath.Join(dir, "missing.gcode")), "")
	if w.Code != 404 {
		t.Fatal(w.Code)
	}
	text := strings.Repeat("G1 X1\n", 1)
	os.WriteFile(filepath.Join(dir, "ok.gcode"), []byte(text), 0644)
	if w := call(a, "GET", "/api/bridge/file?path="+url.QueryEscape(filepath.Join(dir, "ok.gcode")), ""); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
}

func quote(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
