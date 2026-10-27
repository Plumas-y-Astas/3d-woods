package main

import (
	"context"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestTrashPreservesFilesAndRemovesCatalogAndScanEntry(t *testing.T) {
	a := testApp(t)
	dir := filepath.Join(a.root, "Caja")
	os.Mkdir(dir, 0755)
	os.WriteFile(filepath.Join(dir, "objeto.stl"), []byte("original intact"), 0644)
	w := call(a, "POST", "/api/state", `{"version":1,"boxes":[{"id":"box-1","folder":"Caja"}],"ledger":[{"id":"sale-1"}]}`)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	w = call(a, "POST", "/api/trash-box", `{"id":"wrong","folder":"Caja"}`)
	if w.Code != 400 {
		t.Fatal("accepted mismatched identity")
	}
	w = call(a, "POST", "/api/trash-box", `{"id":"box-1","folder":"Caja"}`)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var result struct {
		Trash string `json:"trash"`
	}
	json.Unmarshal(w.Body.Bytes(), &result)
	b, e := os.ReadFile(filepath.Join(result.Trash, "objeto.stl"))
	if e != nil || string(b) != "original intact" {
		t.Fatal("file lost", e)
	}
	state, _ := a.load()
	if len(state["boxes"].([]any)) != 0 || len(state["ledger"].([]any)) != 1 {
		t.Fatal("catalog inconsistent", state)
	}
	var scan struct {
		Boxes []object `json:"boxes"`
	}
	json.Unmarshal(call(a, "GET", "/api/scan", "").Body.Bytes(), &scan)
	if len(scan.Boxes) != 0 {
		t.Fatal("trash reappeared")
	}
	for _, folder := range []string{"", "..", ".3dwoods-papelera", "Caja/sub", "../other"} {
		body, _ := json.Marshal(object{"id": "box-1", "folder": folder})
		if call(a, "POST", "/api/trash-box", string(body)).Code != 400 {
			t.Fatal("accepted invalid folder", folder)
		}
	}
}
func TestLocalNetworkProbeDetectsConnectionAndDisconnectWithoutSendingData(t *testing.T) {
	listener, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	r := probeNetwork(ctx, "127.0.0.1", port)
	if !r.Connected {
		t.Fatal(r)
	}
	listener.Close()
	r = probeNetwork(ctx, "127.0.0.1", port)
	if r.Connected {
		t.Fatal("still connected")
	}
	for _, h := range []string{"https://printer", "1.1.1.1", "bad/name"} {
		if probeNetwork(ctx, h, port).Connected {
			t.Fatal("non-local input accepted", h)
		}
	}
	if probeNetwork(ctx, "127.0.0.1", 0).Connected {
		t.Fatal("port 0 accepted")
	}
}
func TestPrinterStatusDoesNotPretendUnconfiguredPrinterIsOnline(t *testing.T) {
	a := testApp(t)
	w := call(a, "POST", "/api/printers", `{"printers":[{"id":"p1","connection":"none"}]}`)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var result struct {
		Statuses map[string]connectionResult `json:"statuses"`
	}
	json.Unmarshal(w.Body.Bytes(), &result)
	if result.Statuses["p1"].Connected {
		t.Fatal("unconfigured printer online")
	}
}
