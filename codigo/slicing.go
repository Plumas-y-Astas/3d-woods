package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
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

type sliceJob struct {
	mu     sync.Mutex
	State  string `json:"state"`
	Log    string `json:"log"`
	File   string `json:"file"`
	cancel context.CancelFunc
}

func (j *sliceJob) Write(b []byte) (int, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.Log += string(b)
	if len(j.Log) > 24000 {
		j.Log = j.Log[len(j.Log)-24000:]
	}
	return len(b), nil
}
func (j *sliceJob) status() object {
	j.mu.Lock()
	defer j.mu.Unlock()
	return object{"state": j.State, "log": j.Log, "file": j.File}
}

type sliceRequest struct {
	Engine             string              `json:"engine"`
	Definition         string              `json:"definition"`
	ExtruderDefinition string              `json:"extruderDefinition"`
	Settings           map[string]string   `json:"settings"`
	Extruders          []map[string]string `json:"extruders"`
	Models             []struct {
		Path string `json:"path"`
		Tool int    `json:"tool"`
	} `json:"models"`
}

var settingKey = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_]{0,100}$`)

func settingsArgs(m map[string]string) ([]string, error) {
	if len(m) > 3000 {
		return nil, errors.New("Demasiados ajustes")
	}
	keys := []string{}
	for k, v := range m {
		if !settingKey.MatchString(k) || strings.ContainsRune(v, 0) || len(v) > 16000 {
			return nil, errors.New("Ajuste del motor inválido")
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	args := []string{}
	for _, k := range keys {
		args = append(args, "-s", k+"="+m[k])
	}
	return args, nil
}
func existingFile(p string) bool { s, e := os.Stat(p); return e == nil && !s.IsDir() }
func enginePaths(engine string) (string, string, string) {
	if engine == "" {
		if cura := findCura(); cura != "" {
			engine = filepath.Join(filepath.Dir(cura), "CuraEngine.exe")
		}
	}
	if engine == "" {
		engine, _ = exec.LookPath("CuraEngine")
	}
	if !existingFile(engine) {
		return "", "", ""
	}
	base := filepath.Dir(engine)
	for _, root := range []string{filepath.Join(base, "share", "cura", "resources"), filepath.Join(base, "resources"), "/usr/share/cura/resources", "/usr/share/cura"} {
		def := filepath.Join(root, "definitions", "fdmprinter.def.json")
		if existingFile(def) {
			ext := filepath.Join(root, "definitions", "fdmextruder.def.json")
			if !existingFile(ext) {
				ext = filepath.Join(root, "extruders", "fdmextruder.def.json")
			}
			return engine, def, ext
		}
	}
	return engine, "", ""
}
func (a *app) engineInfo(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Engine string `json:"engine"`
		Pick   bool   `json:"pick"`
		Mode   string `json:"mode"`
	}
	if e := readBody(w, r, &in); e != nil {
		fail(w, e)
		return
	}
	if in.Pick {
		p, e := pickExecutable()
		if e != nil {
			fail(w, e)
			return
		}
		if p == "" {
			reply(w, object{"canceled": true})
			return
		}
		in.Engine = p
	}
	if in.Mode != "custom" && !in.Pick && runtime.GOOS == "windows" {
		engine, def, ext, e := bundledEnginePaths()
		if e != nil {
			fail(w, e)
			return
		}
		reply(w, object{"engine": engine, "definition": def, "extruderDefinition": ext, "available": true, "mode": "builtin", "version": "5.13.0"})
		return
	}
	engine, def, ext := enginePaths(in.Engine)
	reply(w, object{"engine": engine, "definition": def, "extruderDefinition": ext, "available": engine != "" && def != ""})
}
func (a *app) sliceStart(w http.ResponseWriter, r *http.Request) {
	var in sliceRequest
	if e := readBody(w, r, &in); e != nil {
		fail(w, e)
		return
	}
	if !filepath.IsAbs(in.Engine) || !existingFile(in.Engine) || !strings.EqualFold(filepath.Base(in.Engine), "CuraEngine.exe") && !strings.EqualFold(filepath.Base(in.Engine), "CuraEngine") {
		fail(w, errors.New("Selecciona el ejecutable CuraEngine de tu instalación local"))
		return
	}
	if !filepath.IsAbs(in.Definition) || !existingFile(in.Definition) || !strings.HasSuffix(in.Definition, ".def.json") {
		fail(w, errors.New("Selecciona fdmprinter.def.json de la misma versión de CuraEngine"))
		return
	}
	if len(in.Models) == 0 || len(in.Models) > 100 || len(in.Extruders) < 1 || len(in.Extruders) > 8 {
		fail(w, errors.New("Se admiten de 1 a 100 mallas y de 1 a 8 herramientas"))
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.slicing != nil && a.slicing.status()["state"] == "running" {
		fail(w, errors.New("Ya hay un laminado en curso"))
		return
	}
	dir, e := a.inside(".3dwoods-laminados/" + identifier())
	if e != nil {
		fail(w, e)
		return
	}
	if e = os.MkdirAll(dir, 0700); e != nil {
		fail(w, e)
		return
	}
	output := filepath.Join(dir, "impresion.gcode")
	args := []string{"slice", "-p", "-j", in.Definition, "-o", output}
	defaults, e := definitionDefaults(in.Definition)
	if e != nil {
		fail(w, e)
		return
	}
	globalValues := mergedSettings(defaults, in.Settings)
	global, e := settingsDefinition(filepath.Join(dir, "global.def.json"), globalValues)
	if e != nil {
		fail(w, e)
		return
	}
	args = append(args, "-j", global)
	for i, settings := range in.Extruders {
		args = append(args, fmt.Sprintf("-e%d", i))
		if in.ExtruderDefinition != "" {
			if !filepath.IsAbs(in.ExtruderDefinition) || !existingFile(in.ExtruderDefinition) || !strings.HasSuffix(in.ExtruderDefinition, ".def.json") {
				fail(w, errors.New("Definición de extrusor inválida"))
				return
			}
			args = append(args, "-j", in.ExtruderDefinition)
		}
		toolDefaults := mergedSettings(defaults, nil)
		if in.ExtruderDefinition != "" {
			extra, e := definitionDefaults(in.ExtruderDefinition)
			if e != nil {
				fail(w, e)
				return
			}
			toolDefaults = mergedSettings(toolDefaults, extra)
		}
		values, e := settingsDefinition(filepath.Join(dir, fmt.Sprintf("tool-%d.def.json", i)), mergedSettings(toolDefaults, settings))
		if e != nil {
			fail(w, e)
			return
		}
		args = append(args, "-j", values)
	}
	for _, m := range in.Models {
		if m.Tool < 0 || m.Tool >= len(in.Extruders) {
			fail(w, errors.New("Herramienta fuera del perfil"))
			return
		}
		p, e := a.inside(m.Path)
		if e != nil || !strings.EqualFold(filepath.Ext(p), ".stl") || !existingFile(p) {
			fail(w, errors.New("Modelo STL preparado no disponible"))
			return
		}
		args = append(args, fmt.Sprintf("-e%d", m.Tool), "-l", p)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	job := &sliceJob{State: "running", cancel: cancel}
	a.slicing = job
	cmd := exec.CommandContext(ctx, in.Engine, args...)
	hideCommand(cmd)
	cmd.Env = append(os.Environ(), "USE_SENTRY=0", "CURA_ENGINE_SEARCH_PATH="+engineDefinitionDirs(in.Definition, in.ExtruderDefinition))
	cmd.Dir = filepath.Dir(in.Engine)
	cmd.Stdout = job
	cmd.Stderr = job
	rel, _ := filepath.Rel(a.root, output)
	go func() {
		defer cancel()
		e := cmd.Run()
		job.mu.Lock()
		defer job.mu.Unlock()
		if e != nil {
			job.State = "error"
			job.Log += "\n" + e.Error()
			return
		}
		stat, e := os.Stat(output)
		if e != nil || stat.Size() < 100 {
			job.State = "error"
			job.Log += "\nEl motor no generó G-code válido"
			return
		}
		job.State = "ready"
		job.File = filepath.ToSlash(rel)
	}()
	reply(w, object{"started": true})
}
func (a *app) sliceStatus(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	j := a.slicing
	a.mu.Unlock()
	if j == nil {
		reply(w, object{"state": "idle"})
		return
	}
	reply(w, j.status())
}
func (a *app) sliceCancel(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	j := a.slicing
	a.mu.Unlock()
	if j != nil && j.cancel != nil {
		j.cancel()
	}
	reply(w, object{"canceled": true})
}

func (a *app) engineKeys(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Path string `json:"path"`
	}
	if e := readBody(w, r, &in); e != nil {
		fail(w, e)
		return
	}
	if !filepath.IsAbs(in.Path) || !strings.HasSuffix(in.Path, ".def.json") {
		fail(w, errors.New("Indica la definición del motor"))
		return
	}
	m, e := readObject(in.Path)
	if e != nil {
		fail(w, e)
		return
	}
	keys := []object{}
	var walk func(map[string]any)
	walk = func(group map[string]any) {
		for key, raw := range group {
			v, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			if v["type"] != "category" {
				keys = append(keys, object{"key": key, "label": v["label"], "default": v["default_value"], "type": v["type"]})
			}
			if child, ok := v["children"].(map[string]any); ok {
				walk(child)
			}
		}
	}
	if group, ok := m["settings"].(map[string]any); ok {
		walk(group)
	}
	sort.Slice(keys, func(i, j int) bool { return str(keys[i], "key") < str(keys[j], "key") })
	reply(w, object{"keys": keys})
}

func settingsDefinition(path string, values map[string]string) (string, error) {
	if _, e := settingsArgs(values); e != nil {
		return "", e
	}
	settings := object{}
	for key, value := range values {
		settings[key] = object{"default_value": value}
	}
	e := atomicJSON(path, object{"version": 2, "name": "3D-Woods resolved values", "settings": settings})
	return path, e
}
