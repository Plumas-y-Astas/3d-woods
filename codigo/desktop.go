package main

import (
	"bytes"
	"crypto/rand"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

//go:embed dist
var assets embed.FS

type object map[string]any
type app struct {
	mu                           sync.Mutex
	updateMu                     sync.Mutex
	root, config, token, address string
	bridge                       string
	server                       *http.Server
	printing                     *printJob
	pendingUpdate                *pendingUpdate
	listUSB                      func() ([]connectedDevice, error)
	openUSB                      func(string, int) (io.ReadWriteCloser, error)
}

func identifier() string {
	b := make([]byte, 16)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b)
}
func str(m object, k string) string { s, _ := m[k].(string); return s }
func readObject(path string) (object, error) {
	b, e := os.ReadFile(path)
	if e != nil {
		return nil, e
	}
	m := object{}
	e = json.Unmarshal(b, &m)
	return m, e
}
func atomicJSON(path string, v any) error {
	b, e := json.MarshalIndent(v, "", "  ")
	if e != nil {
		return e
	}
	// Saving the catalogue writes one copy per box. Skip files whose content did
	// not change so a large collection does not rewrite its whole folder on
	// every small edit or cover capture.
	if current, e := os.ReadFile(path); e == nil && bytes.Equal(current, b) {
		return nil
	}
	f, e := os.CreateTemp(filepath.Dir(path), ".woods-*.tmp")
	if e != nil {
		return e
	}
	name := f.Name()
	defer os.Remove(name)
	if _, e = f.Write(b); e != nil {
		f.Close()
		return e
	}
	if e = f.Sync(); e != nil {
		f.Close()
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	return replaceFile(name, path)
}
func (a *app) inside(relative string) (string, error) {
	if relative == "" {
		return a.root, nil
	}
	if filepath.IsAbs(relative) || strings.HasPrefix(relative, "/") || strings.HasPrefix(relative, `\`) || strings.Contains(relative, ":") || strings.ContainsRune(relative, '\x00') {
		return "", errors.New("Ruta inválida")
	}
	p := filepath.Join(a.root, filepath.FromSlash(relative))
	rel, e := filepath.Rel(a.root, p)
	if e != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", errors.New("Ruta fuera de la estantería")
	}
	current := p
	for {
		resolved, e := filepath.EvalSymlinks(current)
		if e == nil {
			rel, e = filepath.Rel(a.root, resolved)
			if e != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
				return "", errors.New("No se permiten enlaces fuera de la estantería")
			}
			break
		}
		if !os.IsNotExist(e) {
			return "", e
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", e
		}
		current = parent
	}
	return p, nil
}
func reply(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, e error) { http.Error(w, e.Error(), http.StatusBadRequest) }
func readBody(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<20)
	return json.NewDecoder(r.Body).Decode(v)
}
func (a *app) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		if r.Host != a.address {
			http.Error(w, "Host no permitido", 403)
			return
		}
		if r.URL.Path == "/" && r.URL.Query().Get("key") != "" {
			if subtle.ConstantTimeCompare([]byte(r.URL.Query().Get("key")), []byte(a.token)) != 1 {
				http.Error(w, "Sesión inválida", 403)
				return
			}
			http.SetCookie(w, &http.Cookie{Name: "woods", Value: a.token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
			http.Redirect(w, r, "/", http.StatusSeeOther)
			return
		}
		c, e := r.Cookie("woods")
		if e != nil || subtle.ConstantTimeCompare([]byte(c.Value), []byte(a.token)) != 1 {
			http.Error(w, "Abre 3D-Woods desde la aplicación.", 403)
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			if r.Header.Get("Origin") != "http://"+a.address || r.Header.Get("X-Woods-Request") != "1" {
				http.Error(w, "Origen no permitido", 403)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
func (a *app) load() (object, error) {
	m, e := readObject(filepath.Join(a.root, ".3dwoods-library.json"))
	if os.IsNotExist(e) {
		return nil, nil
	}
	return m, e
}
func (a *app) state(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if r.Method == "GET" {
		m, e := a.load()
		if e != nil {
			fail(w, e)
			return
		}
		reply(w, object{"state": m, "root": a.root, "version": appVersion, "publisher": appPublisher, "updateRepo": updateRepo, "platform": runtime.GOOS})
		return
	}
	if r.Method != "POST" {
		w.WriteHeader(405)
		return
	}
	m := object{}
	if e := readBody(w, r, &m); e != nil {
		fail(w, e)
		return
	}
	if m["version"] != float64(1) {
		fail(w, errors.New("Versión de catálogo inválida"))
		return
	}
	if boxes, ok := m["boxes"].([]any); ok {
		for _, v := range boxes {
			b, ok := v.(map[string]any)
			if !ok {
				continue
			}
			folder := str(b, "folder")
			if folder == "" {
				continue
			}
			p, e := a.inside(folder)
			if e != nil {
				fail(w, e)
				return
			}
			stat, e := os.Stat(p)
			if e != nil || !stat.IsDir() {
				continue
			}
			if e = atomicJSON(filepath.Join(p, ".3dwoods.json"), b); e != nil {
				fail(w, e)
				return
			}
		}
	}
	if e := atomicJSON(filepath.Join(a.root, ".3dwoods-library.json"), m); e != nil {
		fail(w, e)
		return
	}
	reply(w, object{"saved": true})
}

var supported = regexp.MustCompile(`(?i)\.(stl|obj|3mf|glb|gcode|gco|png|jpe?g|webp|svg|pdf|txt|mtl)$`)

func (a *app) scan(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	dirs, e := os.ReadDir(a.root)
	if e != nil {
		fail(w, e)
		return
	}
	boxes := []any{}
	for _, entry := range dirs {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		folder := entry.Name()
		dir, e := a.inside(folder)
		if e != nil {
			continue
		}
		b, e := readObject(filepath.Join(dir, ".3dwoods.json"))
		if e != nil || str(b, "id") == "" {
			b = object{"id": identifier(), "name": folder, "category": "Sin categoría", "description": "", "demo": false, "objects": []any{object{"id": identifier(), "name": folder, "kind": "3D", "sizeClass": "regular", "assembly": false, "parts": []any{}, "extras": []any{}, "multiplier": 4, "orderQty": 1, "laborMinutes": 0, "setupCost": 0}}, "createdAt": time.Now().Format(time.RFC3339), "folder": folder}
			if e = atomicJSON(filepath.Join(dir, ".3dwoods.json"), b); e != nil {
				fail(w, e)
				return
			}
		}
		files := []any{}
		e = filepath.WalkDir(dir, func(path string, d fs.DirEntry, e error) error {
			if e != nil {
				return e
			}
			if d.IsDir() {
				if path != dir && strings.HasPrefix(d.Name(), ".") {
					return filepath.SkipDir
				}
				return nil
			}
			if d.Type()&os.ModeSymlink != 0 || !supported.MatchString(d.Name()) {
				return nil
			}
			inf, e := d.Info()
			if e != nil {
				return e
			}
			rel, _ := filepath.Rel(a.root, path)
			files = append(files, object{"id": filepath.ToSlash(rel), "name": d.Name(), "size": inf.Size(), "modified": inf.ModTime().UnixMilli()})
			return nil
		})
		if e != nil {
			fail(w, e)
			return
		}
		b["folder"] = folder
		b["files"] = files
		boxes = append(boxes, b)
	}
	reply(w, object{"boxes": boxes, "root": a.root})
}
func safeName(s string) string {
	s = regexp.MustCompile(`[<>:"/\\|?*\x00-\x1f]`).ReplaceAllString(s, "_")
	s = strings.Trim(s, " .")
	if s == "" {
		s = "Caja"
	}
	if len([]rune(s)) > 100 {
		s = string([]rune(s)[:100])
	}
	if regexp.MustCompile(`(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)`).MatchString(s) {
		s = "_" + s
	}
	return s
}
func uniquePath(dir, name string) string {
	base, ext := strings.TrimSuffix(name, filepath.Ext(name)), filepath.Ext(name)
	p := filepath.Join(dir, name)
	for n := 2; ; n++ {
		if _, e := os.Stat(p); os.IsNotExist(e) {
			return p
		}
		p = filepath.Join(dir, fmt.Sprintf("%s (%d)%s", base, n, ext))
	}
}
func (a *app) createBox(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	var req struct {
		Name string `json:"name"`
		Box  object `json:"box"`
	}
	if e := readBody(w, r, &req); e != nil {
		fail(w, e)
		return
	}
	p := uniquePath(a.root, safeName(req.Name))
	if e := os.Mkdir(p, 0755); e != nil {
		fail(w, e)
		return
	}
	if req.Box == nil {
		req.Box = object{}
	}
	req.Box["folder"] = filepath.Base(p)
	if e := atomicJSON(filepath.Join(p, ".3dwoods.json"), req.Box); e != nil {
		fail(w, e)
		return
	}
	reply(w, object{"box": req.Box})
}
func (a *app) upload(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	// Sin tope de tamaño: los archivos grandes se vuelcan a disco temporal.
	if e := r.ParseMultipartForm(2 << 20); e != nil {
		fail(w, e)
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	folder := r.FormValue("folder")
	if folder == "" {
		fail(w, errors.New("Selecciona una caja"))
		return
	}
	dir, e := a.inside(folder)
	if e != nil {
		fail(w, e)
		return
	}
	f, h, e := r.FormFile("file")
	if e != nil {
		fail(w, e)
		return
	}
	defer f.Close()
	name := safeName(h.Filename)
	if !supported.MatchString(name) {
		fail(w, errors.New("Formato no compatible"))
		return
	}
	p := uniquePath(dir, name)
	out, e := os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
	if e != nil {
		fail(w, e)
		return
	}
	n, e := io.Copy(out, f)
	closeErr := out.Close()
	if e != nil || closeErr != nil {
		os.Remove(p)
		if e == nil {
			e = closeErr
		}
		fail(w, e)
		return
	}
	rel, _ := filepath.Rel(a.root, p)
	reply(w, object{"id": filepath.ToSlash(rel), "name": filepath.Base(p), "size": n, "modified": time.Now().UnixMilli()})
}
func (a *app) file(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	p, e := a.inside(r.URL.Query().Get("path"))
	a.mu.Unlock()
	if e != nil {
		fail(w, e)
		return
	}
	if !supported.MatchString(p) {
		http.Error(w, "Archivo no permitido", 403)
		return
	}
	stat, e := os.Stat(p)
	if e != nil || stat.IsDir() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Disposition", "attachment")
	http.ServeFile(w, r, p)
}
func (a *app) prepare(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	r.Body = http.MaxBytesReader(w, r.Body, 200<<20)
	if e := r.ParseMultipartForm(2 << 20); e != nil {
		fail(w, e)
		return
	}
	defer r.MultipartForm.RemoveAll()
	files := r.MultipartForm.File["models"]
	if len(files) == 0 || len(files) > 100 {
		fail(w, errors.New("Prepara entre 1 y 100 componentes por envío"))
		return
	}
	dir, e := a.inside(".3dwoods-preparados")
	if e != nil {
		fail(w, e)
		return
	}
	if e = os.MkdirAll(dir, 0755); e != nil {
		fail(w, e)
		return
	}
	dir, e = os.MkdirTemp(dir, "montaje-")
	if e != nil {
		fail(w, e)
		return
	}
	ids := []string{}
	ok := false
	defer func() {
		if !ok {
			os.RemoveAll(dir)
		}
	}()
	for _, h := range files {
		if !strings.EqualFold(filepath.Ext(h.Filename), ".stl") {
			fail(w, errors.New("Solo STL preparados"))
			return
		}
		f, e := h.Open()
		if e != nil {
			fail(w, e)
			return
		}
		p := uniquePath(dir, safeName(h.Filename))
		out, e := os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
		if e != nil {
			f.Close()
			fail(w, e)
			return
		}
		_, e = io.Copy(out, f)
		f.Close()
		out.Close()
		if e != nil {
			fail(w, e)
			return
		}
		rel, _ := filepath.Rel(a.root, p)
		ids = append(ids, filepath.ToSlash(rel))
	}
	ok = true
	reply(w, object{"files": ids})
}
func (a *app) saveFile(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 500<<20)
	if e := r.ParseMultipartForm(2 << 20); e != nil {
		fail(w, e)
		return
	}
	defer r.MultipartForm.RemoveAll()
	f, h, e := r.FormFile("file")
	if e != nil {
		fail(w, e)
		return
	}
	defer f.Close()
	path, e := pickSaveFile(safeName(h.Filename))
	if e != nil {
		fail(w, e)
		return
	}
	if path == "" {
		reply(w, object{"canceled": true})
		return
	}
	out, e := os.CreateTemp(filepath.Dir(path), ".woods-export-*.tmp")
	if e != nil {
		fail(w, e)
		return
	}
	temp := out.Name()
	defer os.Remove(temp)
	_, e = io.Copy(out, f)
	if e != nil {
		out.Close()
		fail(w, e)
		return
	}
	if e = out.Sync(); e != nil {
		out.Close()
		fail(w, e)
		return
	}
	if e = out.Close(); e != nil {
		fail(w, e)
		return
	}
	if e = replaceFile(temp, path); e != nil {
		fail(w, e)
		return
	}
	reply(w, object{"saved": true})
}
func (a *app) chooseRoot(w http.ResponseWriter, r *http.Request) {
	path, e := pickFolder()
	if e != nil {
		fail(w, e)
		return
	}
	if path == "" {
		reply(w, object{"canceled": true})
		return
	}
	path, e = filepath.EvalSymlinks(path)
	if e != nil {
		fail(w, e)
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	old := a.root
	a.root = path
	m, e := a.load()
	if e != nil {
		a.root = old
		fail(w, e)
		return
	}
	if e = atomicJSON(a.config, object{"root": path}); e != nil {
		a.root = old
		fail(w, e)
		return
	}
	reply(w, object{"root": a.root, "state": m})
}
func (a *app) chooseSlicer(w http.ResponseWriter, r *http.Request) {
	path, e := pickExecutable()
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, object{"path": path})
}
func findCura() string {
	if runtime.GOOS == "windows" {
		for _, base := range []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs")} {
			for _, pat := range []string{"UltiMaker Cura*", "Ultimaker Cura*"} {
				dirs, _ := filepath.Glob(filepath.Join(base, pat))
				sort.Sort(sort.Reverse(sort.StringSlice(dirs)))
				for _, d := range dirs {
					for _, name := range []string{"UltiMaker-Cura.exe", "Ultimaker-Cura.exe", "Cura.exe"} {
						p := filepath.Join(d, name)
						if s, e := os.Stat(p); e == nil && !s.IsDir() {
							return p
						}
					}
				}
			}
		}
	}
	p, _ := exec.LookPath("cura")
	return p
}

// Busca los laminadores externos más habituales sin imponer uno en concreto.
func findSlicer() string {
	if p := findCura(); p != "" {
		return p
	}
	if runtime.GOOS == "windows" {
		candidates := []string{
			filepath.Join(os.Getenv("ProgramFiles"), "Prusa3D", "PrusaSlicer", "prusa-slicer.exe"),
			filepath.Join(os.Getenv("ProgramFiles"), "OrcaSlicer", "orca-slicer.exe"),
			filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "OrcaSlicer", "orca-slicer.exe"),
			filepath.Join(os.Getenv("ProgramFiles"), "Bambu Studio", "bambu-studio.exe"),
			filepath.Join(os.Getenv("ProgramFiles"), "Simplify3D", "Simplify3D.exe"),
		}
		patterns := []string{
			filepath.Join(os.Getenv("ProgramFiles"), "Simplify3D-*", "Simplify3D.exe"),
			filepath.Join(os.Getenv("ProgramFiles"), "Prusa3D", "PrusaSlicer", "*", "prusa-slicer.exe"),
		}
		for _, p := range candidates {
			if s, e := os.Stat(p); e == nil && !s.IsDir() {
				return p
			}
		}
		for _, pat := range patterns {
			matches, _ := filepath.Glob(pat)
			sort.Sort(sort.Reverse(sort.StringSlice(matches)))
			for _, p := range matches {
				if s, e := os.Stat(p); e == nil && !s.IsDir() {
					return p
				}
			}
		}
	}
	for _, name := range []string{"prusa-slicer", "orca-slicer", "bambu-studio", "Simplify3D"} {
		if p, e := exec.LookPath(name); e == nil {
			return p
		}
	}
	return ""
}
func (a *app) launch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Files      []string `json:"files"`
		Executable string   `json:"executable"`
	}
	if e := readBody(w, r, &req); e != nil {
		fail(w, e)
		return
	}
	if len(req.Files) == 0 || len(req.Files) > 100 {
		fail(w, errors.New("Selecciona entre 1 y 100 modelos"))
		return
	}
	ex := req.Executable
	if ex == "" {
		ex = findSlicer()
	}
	if ex == "" {
		fail(w, errors.New("Selecciona el ejecutable del laminador en Ajustes → Puente de impresión."))
		return
	}
	if !filepath.IsAbs(ex) {
		fail(w, errors.New("Selecciona una ruta completa del laminador"))
		return
	}
	if runtime.GOOS == "windows" && !strings.EqualFold(filepath.Ext(ex), ".exe") {
		fail(w, errors.New("Selecciona un archivo .exe"))
		return
	}
	if inf, e := os.Stat(ex); e != nil || inf.IsDir() {
		fail(w, errors.New("No se encuentra el laminador seleccionado"))
		return
	}
	args := []string{}
	a.mu.Lock()
	for _, name := range req.Files {
		p, e := a.inside(name)
		if e != nil {
			a.mu.Unlock()
			fail(w, e)
			return
		}
		if !regexp.MustCompile(`(?i)\.(stl|obj|3mf|glb)$`).MatchString(p) {
			a.mu.Unlock()
			fail(w, errors.New("El archivo no es un modelo 3D"))
			return
		}
		if _, e := os.Stat(p); e != nil {
			a.mu.Unlock()
			fail(w, e)
			return
		}
		args = append(args, p)
	}
	a.mu.Unlock()
	cmd := exec.Command(ex, args...)
	if e := cmd.Start(); e != nil {
		fail(w, e)
		return
	}
	go cmd.Wait()
	reply(w, object{"opened": true, "files": len(args)})
}
func (a *app) reveal(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Folder string `json:"folder"`
	}
	if e := readBody(w, r, &req); e != nil {
		fail(w, e)
		return
	}
	a.mu.Lock()
	p, e := a.inside(req.Folder)
	a.mu.Unlock()
	if e == nil {
		e = openFolder(p)
	}
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, object{"opened": true})
}
func post(handler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(405)
			return
		}
		handler(w, r)
	}
}
func (a *app) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/state", a.state)
	mux.HandleFunc("/api/print-start", post(a.printStart))
	mux.HandleFunc("/api/usb-test", post(a.usbTest))
	mux.HandleFunc("/api/print-status", a.printStatus)
	mux.HandleFunc("/api/print-control", post(a.printControl))
	mux.HandleFunc("/api/scan", a.scan)
	mux.HandleFunc("/api/box", post(a.createBox))
	mux.HandleFunc("/api/trash-box", post(a.trashBox))
	mux.HandleFunc("/api/open-trash", post(func(w http.ResponseWriter, r *http.Request) {
		a.mu.Lock()
		defer a.mu.Unlock()
		p, e := a.inside(".3dwoods-papelera")
		if e == nil {
			e = os.MkdirAll(p, 0700)
		}
		if e == nil {
			e = openFolder(p)
		}
		if e != nil {
			fail(w, e)
			return
		}
		reply(w, object{"opened": true})
	}))
	mux.HandleFunc("/api/printers", post(a.printerStatus))
	mux.HandleFunc("/api/upload", post(a.upload))
	mux.HandleFunc("/api/file", a.file)
	mux.HandleFunc("/api/choose-root", post(a.chooseRoot))
	mux.HandleFunc("/api/choose-slicer", post(a.chooseSlicer))
	mux.HandleFunc("/api/bridge/choose", post(a.bridgeChoose))
	mux.HandleFunc("/api/bridge/scan", post(a.bridgeScan))
	mux.HandleFunc("/api/bridge/file", a.bridgeFile)
	mux.HandleFunc("/api/bridge/open", post(a.bridgeOpen))
	mux.HandleFunc("/api/launch", post(a.launch))
	mux.HandleFunc("/api/reveal", post(a.reveal))
	mux.HandleFunc("/api/quit", post(func(w http.ResponseWriter, r *http.Request) {
		a.mu.Lock()
		active := a.printing != nil && a.printing.active()
		a.mu.Unlock()
		if active {
			fail(w, errors.New("Hay una impresión USB activa"))
			return
		}
		reply(w, object{"closed": true})
		go func() { time.Sleep(300 * time.Millisecond); a.server.Close() }()
	}))
	mux.HandleFunc("/api/prepare", post(a.prepare))
	mux.HandleFunc("/api/save-file", post(a.saveFile))
	mux.HandleFunc("/api/version", a.versionInfo)
	mux.HandleFunc("/api/update/check", post(a.updateCheck))
	mux.HandleFunc("/api/update/download", post(a.updateDownload))
	mux.HandleFunc("/api/update/install", post(a.updateInstall))
	mux.HandleFunc("/api/ping", func(w http.ResponseWriter, r *http.Request) { reply(w, object{"alive": true}) })
	public, _ := fs.Sub(assets, "dist")
	static := http.FileServer(http.FS(public))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			b, _ := assets.ReadFile("dist/index.html")
			html := strings.Replace(string(b), "<head>", "<head><meta name=\"woods-desktop\" content=\"1\">", 1)
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			io.WriteString(w, html)
			return
		}
		static.ServeHTTP(w, r)
	})
	return a.guard(mux)
}
func main() {
	cleanupUpdateCache()
	home, e := os.UserHomeDir()
	if e != nil {
		log.Fatal(e)
	}
	cfg, e := os.UserConfigDir()
	if e != nil {
		cfg = home
	}
	cfg = filepath.Join(cfg, "3D-Woods")
	os.MkdirAll(cfg, 0700)
	root := filepath.Join(home, "Documents", "3D-Woods")
	config := filepath.Join(cfg, "settings.json")
	if m, e := readObject(config); e == nil && str(m, "root") != "" {
		root = str(m, "root")
	}
	if override := os.Getenv("WOODS_LIBRARY"); override != "" {
		root = override
	}
	if e = os.MkdirAll(root, 0755); e != nil {
		log.Fatal(e)
	}
	root, _ = filepath.EvalSymlinks(root)
	l, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		log.Fatal(e)
	}
	a := &app{root: root, config: config, token: identifier(), address: l.Addr().String()}
	a.server = &http.Server{Handler: a.handler(), ReadHeaderTimeout: 10 * time.Second, MaxHeaderBytes: 1 << 20}
	entry := "http://" + a.address + "/?key=" + url.QueryEscape(a.token)
	if os.Getenv("WOODS_NO_BROWSER") == "1" {
		fmt.Println(entry)
		if e = a.server.Serve(l); e != nil && !errors.Is(e, http.ErrServerClosed) {
			log.Fatal(e)
		}
	} else {
		go func() {
			if e := a.server.Serve(l); e != nil && !errors.Is(e, http.ErrServerClosed) {
				log.Print(e)
			}
		}()
		runWindow(entry)
		a.server.Close()
	}
}
