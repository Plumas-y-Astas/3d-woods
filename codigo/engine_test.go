package main

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestDefinitionKeepsParentDefaultsAndInheritedOverrides(t *testing.T) {
	dir := t.TempDir()
	base := `{"settings":{"roofing_layer_count":{"default_value":0,"children":{"roofing_pattern":{"default_value":"lines"}}},"array_setting":{"default_value":[1,2]}}}`
	child := `{"inherits":"base","overrides":{"roofing_layer_count":{"default_value":2},"roofing_pattern":{"default_value":"concentric"}}}`
	os.WriteFile(filepath.Join(dir, "base.def.json"), []byte(base), 0600)
	os.WriteFile(filepath.Join(dir, "child.def.json"), []byte(child), 0600)
	values, e := definitionDefaults(filepath.Join(dir, "child.def.json"))
	if e != nil || values["roofing_layer_count"] != "2" || values["roofing_pattern"] != "concentric" || values["array_setting"] != "[1,2]" {
		t.Fatal(values, e)
	}
	merged := mergedSettings(values, map[string]string{"roofing_layer_count": "3"})
	if merged["roofing_layer_count"] != "3" || values["roofing_layer_count"] != "2" {
		t.Fatal("user overrides must win without changing defaults")
	}
	os.WriteFile(filepath.Join(dir, "base.def.json"), []byte(`{"inherits":"child"}`), 0600)
	if _, e := definitionDefaults(filepath.Join(dir, "child.def.json")); e == nil {
		t.Fatal("circular inheritance accepted")
	}
}

func TestIncludedEngineExtractsOfflineAndRepairsDamagedCache(t *testing.T) {
	payload, e := engineFiles.ReadFile("engine/windows-x64.zip")
	if e != nil {
		t.Fatal(e)
	}
	destination := filepath.Join(t.TempDir(), "engine")
	if e = extractEnginePayload(payload, destination); e != nil {
		t.Fatal(e)
	}
	engine := filepath.Join(destination, "CuraEngine.exe")
	data, e := os.ReadFile(engine)
	if e != nil || len(data) < 1000000 || string(data[:2]) != "MZ" {
		t.Fatal("missing Windows engine", e)
	}
	values, e := definitionDefaults(filepath.Join(destination, "resources", "definitions", "fdmprinter.def.json"))
	if e != nil || values["roofing_layer_count"] == "" || values["flooring_layer_count"] == "" {
		t.Fatal("missing non-leaf defaults", values["roofing_layer_count"], e)
	}
	os.WriteFile(engine, []byte("damaged"), 0600)
	if e = extractEnginePayload(payload, destination); e != nil {
		t.Fatal(e)
	}
	repaired, _ := os.ReadFile(engine)
	if !bytes.Equal(data, repaired) {
		t.Fatal("cache not repaired")
	}
}

func TestEngineArchiveCannotWriteOutsideItsCache(t *testing.T) {
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	w, _ := z.Create("files.json")
	w.Write([]byte(`{"CuraEngine.exe":"missing"}`))
	w, _ = z.Create("../escape")
	w.Write([]byte("escape"))
	z.Close()
	dir := t.TempDir()
	if e := extractEnginePayload(b.Bytes(), filepath.Join(dir, "engine")); e == nil {
		t.Fatal("path traversal accepted")
	}
	if _, e := os.Stat(filepath.Join(dir, "escape")); e == nil {
		t.Fatal("wrote outside cache")
	}
}
