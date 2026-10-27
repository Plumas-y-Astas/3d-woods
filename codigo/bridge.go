package main

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// El puente no ejecuta ningún laminador: observa una carpeta y entrega el
// G-code que produzca Cura, PrusaSlicer, OrcaSlicer, Bambu Studio o cualquier
// otro programa que escriba archivos compatibles.
var gcodeFile = regexp.MustCompile(`(?i)\.(?:gcode|gco|g)$`)
const bridgeMaxFile = 80 << 20

func bridgeDir(folder string) (string, error) {
	folder = strings.TrimSpace(folder)
	if folder == "" {
		return "", errors.New("Selecciona la carpeta del puente en Ajustes.")
	}
	abs, e := filepath.Abs(folder)
	if e != nil {
		return "", e
	}
	abs, e = filepath.EvalSymlinks(abs)
	if e != nil {
		return "", errors.New("No se encuentra la carpeta del puente")
	}
	info, e := os.Stat(abs)
	if e != nil || !info.IsDir() {
		return "", errors.New("La ruta del puente no es una carpeta")
	}
	return abs, nil
}

func bridgeInside(root, path string) (string, error) {
	abs, e := filepath.Abs(path)
	if e != nil {
		return "", e
	}
	if resolved, e := filepath.EvalSymlinks(abs); e == nil {
		abs = resolved
	}
	rel, e := filepath.Rel(root, abs)
	if e != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
		return "", errors.New("El archivo está fuera de la carpeta del puente")
	}
	return abs, nil
}

func (a *app) bridgeChoose(w http.ResponseWriter, r *http.Request) {
	path, e := pickFolder()
	if e != nil {
		fail(w, e)
		return
	}
	if path == "" {
		reply(w, object{"canceled": true})
		return
	}
	path, e = bridgeDir(path)
	if e != nil {
		fail(w, e)
		return
	}
	a.mu.Lock()
	a.bridge = path
	a.mu.Unlock()
	reply(w, object{"path": path})
}

func (a *app) bridgeScan(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Folder string `json:"folder"`
	}
	if e := readBody(w, r, &in); e != nil {
		fail(w, e)
		return
	}
	folder := in.Folder
	if folder == "" {
		a.mu.Lock()
		folder = a.bridge
		a.mu.Unlock()
	}
	root, e := bridgeDir(folder)
	if e != nil {
		fail(w, e)
		return
	}
	files := []object{}
	walkErr := filepath.WalkDir(root, func(path string, d os.DirEntry, e error) error {
		if e != nil {
			return nil
		}
		if d.IsDir() {
			if path != root && (strings.HasPrefix(d.Name(), ".") || len(files) > 800) {
				return filepath.SkipDir
			}
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 || !gcodeFile.MatchString(d.Name()) {
			return nil
		}
		info, e := d.Info()
		if e != nil || info.Size() > bridgeMaxFile {
			return nil
		}
		rel, _ := filepath.Rel(root, path)
		files = append(files, object{"path": path, "name": d.Name(), "size": info.Size(), "modified": info.ModTime().UnixMilli(), "rel": filepath.ToSlash(rel)})
		if len(files) >= 800 {
			return filepath.SkipAll
		}
		return nil
	})
	if walkErr != nil {
		fail(w, walkErr)
		return
	}
	sort.Slice(files, func(i, j int) bool {
		return files[i]["modified"].(int64) > files[j]["modified"].(int64)
	})
	a.mu.Lock()
	a.bridge = root
	a.mu.Unlock()
	reply(w, object{"folder": root, "files": files, "checkedAt": time.Now().Format(time.RFC3339)})
}

func (a *app) bridgeFile(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	root := a.bridge
	a.mu.Unlock()
	if root == "" {
		fail(w, errors.New("Abre primero la carpeta del puente"))
		return
	}
	path, e := bridgeInside(root, r.URL.Query().Get("path"))
	if e != nil {
		fail(w, e)
		return
	}
	if !gcodeFile.MatchString(path) {
		http.Error(w, "El puente solo entrega G-code", 403)
		return
	}
	info, e := os.Stat(path)
	if e != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	if info.Size() > bridgeMaxFile {
		http.Error(w, "El G-code supera los 80 MB", http.StatusRequestEntityTooLarge)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Disposition", "attachment")
	http.ServeFile(w, r, path)
}

func (a *app) bridgeOpen(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Folder string `json:"folder"`
	}
	if e := readBody(w, r, &in); e != nil {
		fail(w, e)
		return
	}
	if in.Folder == "" {
		a.mu.Lock()
		in.Folder = a.bridge
		a.mu.Unlock()
	}
	root, e := bridgeDir(in.Folder)
	if e != nil {
		fail(w, e)
		return
	}
	if e = openFolder(root); e != nil {
		fail(w, e)
		return
	}
	reply(w, object{"opened": true, "folder": root})
}
