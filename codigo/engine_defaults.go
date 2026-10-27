package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// CuraEngine skips defaults on non-leaf nodes. Flatten every node before passing settings.
func definitionDefaults(path string) (map[string]string, error) {
	return loadDefinitionDefaults(path, map[string]bool{})
}
func loadDefinitionDefaults(path string, visited map[string]bool) (map[string]string, error) {
	out := map[string]string{}
	absolute, e := filepath.Abs(path)
	if e != nil {
		return nil, e
	}
	if visited[absolute] {
		return nil, errors.New("Herencia circular en la definición del motor")
	}
	visited[absolute] = true
	defer delete(visited, absolute)
	m, e := readObject(absolute)
	if e != nil {
		return nil, e
	}
	if parent, ok := m["inherits"].(string); ok && parent != "" {
		if strings.ContainsAny(parent, "/\\") || strings.Contains(parent, "..") {
			return nil, errors.New("Herencia de motor inválida")
		}
		base := filepath.Dir(absolute)
		found := ""
		for _, d := range []string{base, filepath.Join(base, "..", "definitions"), filepath.Join(base, "..", "extruders")} {
			candidate := filepath.Join(d, parent+".def.json")
			if existingFile(candidate) {
				found = candidate
				break
			}
		}
		if found == "" {
			return nil, errors.New("Falta definición padre: " + parent)
		}
		out, e = loadDefinitionDefaults(found, visited)
		if e != nil {
			return nil, e
		}
	}
	put := func(key string, v any) {
		if !settingKey.MatchString(key) {
			return
		}
		switch v.(type) {
		case nil, map[string]any:
			return
		}
		if text, ok := v.(string); ok {
			out[key] = text
			return
		}
		b, e := json.Marshal(v)
		if e == nil {
			out[key] = string(b)
		}
	}
	var walk func(map[string]any)
	walk = func(group map[string]any) {
		for key, raw := range group {
			node, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			if v, ok := node["default_value"]; ok {
				put(key, v)
			}
			if child, ok := node["children"].(map[string]any); ok {
				walk(child)
			}
		}
	}
	if settings, ok := m["settings"].(map[string]any); ok {
		walk(settings)
	}
	if overrides, ok := m["overrides"].(map[string]any); ok {
		walk(overrides)
	}
	return out, nil
}
func mergedSettings(base, overrides map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range base {
		out[k] = v
	}
	for k, v := range overrides {
		out[k] = v
	}
	return out
}
func engineDefinitionDirs(def, ext string) string {
	return strings.Join([]string{filepath.Dir(def), filepath.Dir(ext)}, string(os.PathListSeparator))
}
