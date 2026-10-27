package main

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testApp(t *testing.T) *app {
	t.Helper()
	return &app{root: t.TempDir(), config: filepath.Join(t.TempDir(), "settings.json"), address: "127.0.0.1:12345", token: "test-secret"}
}
func call(a *app, method, path, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "http://"+a.address+path, strings.NewReader(body))
	r.AddCookie(&http.Cookie{Name: "woods", Value: a.token})
	r.Header.Set("Origin", "http://"+a.address)
	r.Header.Set("X-Woods-Request", "1")
	w := httptest.NewRecorder()
	a.handler().ServeHTTP(w, r)
	return w
}
func TestLocalAccessGuards(t *testing.T) {
	a := testApp(t)
	for _, tt := range []struct{ host, token, origin, header, method string }{{"evil.test", a.token, "", "", "GET"}, {a.address, "bad", "", "", "GET"}, {a.address, a.token, "http://evil.test", "1", "POST"}, {a.address, a.token, "http://" + a.address, "", "POST"}} {
		r := httptest.NewRequest(tt.method, "http://"+tt.host+"/api/state", strings.NewReader("{}"))
		r.AddCookie(&http.Cookie{Name: "woods", Value: tt.token})
		r.Header.Set("Origin", tt.origin)
		r.Header.Set("X-Woods-Request", tt.header)
		w := httptest.NewRecorder()
		a.handler().ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatalf("expected 403, got %d", w.Code)
		}
	}
}
func TestPathsCannotEscapeRoot(t *testing.T) {
	a := testApp(t)
	for _, p := range []string{"../private.txt", "/etc/passwd", "C:/Windows/system.ini", "foo/../../private.txt"} {
		if _, e := a.inside(p); e == nil {
			t.Fatal("accepted", p)
		}
	}
	if e := os.Symlink(t.TempDir(), filepath.Join(a.root, "outside")); e == nil {
		if _, e = a.inside("outside/file.stl"); e == nil {
			t.Fatal("accepted symlink escape")
		}
	}
}
func TestNewFoldersAreDetectedAndMetadataPersists(t *testing.T) {
	a := testApp(t)
	p := filepath.Join(a.root, "Mi ciervo")
	os.Mkdir(p, 0755)
	os.WriteFile(filepath.Join(p, "pieza.stl"), []byte("solid test"), 0644)
	os.Mkdir(filepath.Join(p, "sub"), 0755)
	os.WriteFile(filepath.Join(p, "sub", "otra.obj"), []byte("v 1 2 3"), 0644)
	w := call(a, "GET", "/api/scan", "")
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var s struct {
		Boxes []object `json:"boxes"`
	}
	json.Unmarshal(w.Body.Bytes(), &s)
	if len(s.Boxes) != 1 {
		t.Fatal(s)
	}
	b := s.Boxes[0]
	if len(b["files"].([]any)) != 2 {
		t.Fatal(b)
	}
	id := b["id"]
	w = call(a, "GET", "/api/scan", "")
	json.Unmarshal(w.Body.Bytes(), &s)
	if s.Boxes[0]["id"] != id {
		t.Fatal("identity changed")
	}
	if _, e := os.Stat(filepath.Join(p, ".3dwoods.json")); e != nil {
		t.Fatal(e)
	}
}
func TestImportsDoNotOverwriteAndCanBeRead(t *testing.T) {
	a := testApp(t)
	os.Mkdir(filepath.Join(a.root, "Caja"), 0755)
	os.WriteFile(filepath.Join(a.root, "Caja", "part.stl"), []byte("original"), 0644)
	var body bytes.Buffer
	m := multipart.NewWriter(&body)
	m.WriteField("folder", "Caja")
	p, _ := m.CreateFormFile("file", "part.stl")
	p.Write([]byte("new model"))
	m.Close()
	r := httptest.NewRequest("POST", "http://"+a.address+"/api/upload", &body)
	r.Header.Set("Content-Type", m.FormDataContentType())
	r.Header.Set("Origin", "http://"+a.address)
	r.Header.Set("X-Woods-Request", "1")
	r.AddCookie(&http.Cookie{Name: "woods", Value: a.token})
	w := httptest.NewRecorder()
	a.handler().ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var f object
	json.Unmarshal(w.Body.Bytes(), &f)
	if f["name"] != "part (2).stl" {
		t.Fatal(f)
	}
	original, _ := os.ReadFile(filepath.Join(a.root, "Caja", "part.stl"))
	if string(original) != "original" {
		t.Fatal("overwrote original")
	}
	w = call(a, "GET", "/api/file?path=Caja%2Fpart%20%282%29.stl", "")
	got, _ := io.ReadAll(w.Result().Body)
	if string(got) != "new model" {
		t.Fatal(string(got))
	}
}
func TestCatalogSavesAtomicallyAndInvalidPathsAreRejected(t *testing.T) {
	a := testApp(t)
	os.Mkdir(filepath.Join(a.root, "Box"), 0755)
	w := call(a, "POST", "/api/state", `{"version":1,"boxes":[{"folder":"Box","id":"abc","name":"Árbol"}],"settings":{"power":120},"materials":[]}`)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	m, e := readObject(filepath.Join(a.root, "Box", ".3dwoods.json"))
	if e != nil || m["name"] != "Árbol" {
		t.Fatal(m, e)
	}
	w = call(a, "POST", "/api/state", `{"version":1,"boxes":[{"folder":"../outside"}]}`)
	if w.Code != 400 {
		t.Fatal(w.Code)
	}
	w = call(a, "GET", "/", "")
	if !strings.Contains(w.Body.String(), `name="woods-desktop"`) {
		t.Fatal("missing desktop marker")
	}
}
func TestReservedNamesAndExecutableArgumentsAreConstrained(t *testing.T) {
	if safeName("CON") == "CON" {
		t.Fatal("reserved name allowed")
	}
	a := testApp(t)
	w := call(a, "POST", "/api/launch", `{"executable":"relative.exe","files":["test.stl"]}`)
	if w.Code != 400 {
		t.Fatal(w.Code)
	}
	w = call(a, "GET", "/api/upload", "")
	if w.Code != 405 {
		t.Fatal(w.Code)
	}
}

func TestPreparedScaledCopiesAreKeptSeparateFromOriginals(t *testing.T) {
	a := testApp(t)
	var body bytes.Buffer
	m := multipart.NewWriter(&body)
	for _, name := range []string{"base-1.stl", "base-2.stl"} {
		p, _ := m.CreateFormFile("models", name)
		p.Write([]byte("solid prepared\nendsolid prepared"))
	}
	m.Close()
	r := httptest.NewRequest("POST", "http://"+a.address+"/api/prepare", &body)
	r.Header.Set("Content-Type", m.FormDataContentType())
	r.Header.Set("Origin", "http://"+a.address)
	r.Header.Set("X-Woods-Request", "1")
	r.AddCookie(&http.Cookie{Name: "woods", Value: a.token})
	w := httptest.NewRecorder()
	a.handler().ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var got struct {
		Files []string `json:"files"`
	}
	json.Unmarshal(w.Body.Bytes(), &got)
	if len(got.Files) != 2 {
		t.Fatal(got)
	}
	for _, id := range got.Files {
		p, e := a.inside(id)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = os.Stat(p); e != nil {
			t.Fatal(e)
		}
	}
	scan := call(a, "GET", "/api/scan", "")
	if !strings.Contains(scan.Body.String(), `"boxes":[]`) {
		t.Fatal("prepared files leaked into shelf", scan.Body.String())
	}
}

func TestAtomicJSONSkipsUnchangedFiles(t *testing.T) {
	a := testApp(t)
	p := filepath.Join(a.root, "catalog.json")
	if e := atomicJSON(p, object{"a": 1}); e != nil {
		t.Fatal(e)
	}
	first, e := os.Stat(p)
	if e != nil {
		t.Fatal(e)
	}
	time.Sleep(30 * time.Millisecond)
	if e = atomicJSON(p, object{"a": 1}); e != nil {
		t.Fatal(e)
	}
	second, e := os.Stat(p)
	if e != nil {
		t.Fatal(e)
	}
	if !first.ModTime().Equal(second.ModTime()) {
		t.Fatal("unchanged catalogue was rewritten")
	}
	if e = atomicJSON(p, object{"a": 2}); e != nil {
		t.Fatal(e)
	}
	data, e := os.ReadFile(p)
	if e != nil {
		t.Fatal(e)
	}
	if !bytes.Contains(data, []byte(`"a": 2`)) {
		t.Fatal(string(data))
	}
}
