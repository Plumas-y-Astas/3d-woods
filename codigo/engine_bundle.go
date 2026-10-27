package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

//go:embed engine
var engineFiles embed.FS
var engineOnce sync.Once
var engineRoot string
var engineFailure error

func bundledEnginePaths() (string, string, string, error) {
	if runtime.GOOS != "windows" {
		return "", "", "", errors.New("El motor integrado de esta distribución es para Windows x64")
	}
	engineOnce.Do(func() {
		meta, e := engineFiles.ReadFile("engine/runtime.json")
		if e != nil {
			engineFailure = e
			return
		}
		var m struct{ Archive, SHA256 string }
		if e = json.Unmarshal(meta, &m); e != nil {
			engineFailure = e
			return
		}
		payload, e := engineFiles.ReadFile("engine/" + m.Archive)
		if e != nil {
			engineFailure = e
			return
		}
		sum := sha256.Sum256(payload)
		digest := hex.EncodeToString(sum[:])
		if digest != m.SHA256 {
			engineFailure = errors.New("El motor incluido está dañado")
			return
		}
		cache, e := os.UserCacheDir()
		if e != nil {
			engineFailure = e
			return
		}
		engineRoot = filepath.Join(cache, "3D-Woods", "engine", digest[:16])
		engineFailure = extractEnginePayload(payload, engineRoot)
	})
	if engineFailure != nil {
		return "", "", "", engineFailure
	}
	return filepath.Join(engineRoot, "CuraEngine.exe"), filepath.Join(engineRoot, "resources", "definitions", "fdmprinter.def.json"), filepath.Join(engineRoot, "resources", "definitions", "fdmextruder.def.json"), nil
}
func extractEnginePayload(payload []byte, destination string) error {
	z, e := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if e != nil {
		return e
	}
	var hashes map[string]string
	for _, f := range z.File {
		if f.Name == "files.json" {
			r, e := f.Open()
			if e != nil {
				return e
			}
			data, e := io.ReadAll(io.LimitReader(r, 1<<20))
			r.Close()
			if e != nil {
				return e
			}
			if e = json.Unmarshal(data, &hashes); e != nil {
				return e
			}
		}
	}
	if len(hashes) == 0 {
		return errors.New("Manifiesto de motor ausente")
	}
	valid := true
	for name, want := range hashes {
		b, e := os.ReadFile(filepath.Join(destination, filepath.FromSlash(name)))
		if e != nil {
			valid = false
			break
		}
		sum := sha256.Sum256(b)
		if hex.EncodeToString(sum[:]) != want {
			valid = false
			break
		}
	}
	if valid {
		return nil
	}
	if e = os.MkdirAll(filepath.Dir(destination), 0700); e != nil {
		return e
	}
	stage, e := os.MkdirTemp(filepath.Dir(destination), ".engine-")
	if e != nil {
		return e
	}
	defer os.RemoveAll(stage)
	for _, f := range z.File {
		clean := filepath.Clean(filepath.FromSlash(f.Name))
		if filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) || strings.Contains(clean, ":") {
			return errors.New("Ruta inválida en el motor")
		}
		if f.FileInfo().Mode()&os.ModeSymlink != 0 {
			return errors.New("Enlace inválido en el motor")
		}
		p := filepath.Join(stage, clean)
		if f.FileInfo().IsDir() {
			if e = os.MkdirAll(p, 0700); e != nil {
				return e
			}
			continue
		}
		if f.UncompressedSize64 > 100<<20 {
			return errors.New("Archivo de motor demasiado grande")
		}
		if e = os.MkdirAll(filepath.Dir(p), 0700); e != nil {
			return e
		}
		r, e := f.Open()
		if e != nil {
			return e
		}
		b, e := io.ReadAll(io.LimitReader(r, 100<<20))
		r.Close()
		if e != nil {
			return e
		}
		if want, ok := hashes[f.Name]; ok {
			sum := sha256.Sum256(b)
			if hex.EncodeToString(sum[:]) != want {
				return errors.New("Archivo de motor dañado: " + f.Name)
			}
		}
		if e = os.WriteFile(p, b, 0700); e != nil {
			return e
		}
	}
	if e = os.RemoveAll(destination); e != nil {
		return e
	}
	return os.Rename(stage, destination)
}
