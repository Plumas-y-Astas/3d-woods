package main

import (
	"encoding/json"
	"io"
	"strings"
	"testing"
	"time"
)

func TestNativeSerialFallbackMergesWithoutDuplicatePortsAndKeepsLegacyIdentity(t *testing.T) {
	devices := mergeSerialDevices([]uint32{3, 8}, []connectedDevice{{ID: "USB\\BOARD", Name: "USB Serial (COM3)", Port: "com3", Status: "OK"}})
	if len(devices) != 2 || devices[0].ID != "serial:COM3" || devices[1].ID != "serial:COM8" {
		t.Fatal(devices)
	}
	if !matchesDevice(devices[0], "usb\\board", "COM3") || matchesDevice(devices[0], "USB\\BOARD", "COM8") {
		t.Fatal("device identity mismatch")
	}
}

func mockMarlin() *fakeSerial {
	return &fakeSerial{replies: func(s string) string {
		if strings.TrimSpace(s) == "M115" {
			return "FIRMWARE_NAME:Marlin 2.0.8 MACHINE_TYPE:Ender-3 V3 SE\nok\n"
		}
		return "ok\n"
	}}
}
func finishUSB(t *testing.T, a *app, want string) {
	t.Helper()
	deadline := time.Now().Add(6 * time.Second)
	for time.Now().Before(deadline) {
		s := a.printing.status()
		if s["state"] == want {
			return
		}
		if s["state"] == "error" {
			t.Fatal(s)
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal(a.printing.status())
}

func TestUSBProbeThenPrintThroughNativeAPIAreSeparateAndConfirmed(t *testing.T) {
	a := testApp(t)
	a.listUSB = func() ([]connectedDevice, error) {
		return []connectedDevice{{ID: "serial:COM8", Port: "COM8", Name: "Ender", Status: "OK"}}, nil
	}
	ports := []*fakeSerial{}
	a.openUSB = func(port string, baud int) (io.ReadWriteCloser, error) {
		if port != "COM8" || baud != 115200 {
			t.Fatal(port, baud)
		}
		p := mockMarlin()
		ports = append(ports, p)
		return p, nil
	}
	body := `{"port":"COM8","deviceID":"serial:COM8","baud":115200}`
	if w := call(a, "POST", "/api/usb-test", body); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	finishUSB(t, a, "connected")
	ports[0].mu.Lock()
	writes := strings.Join(ports[0].writes, "")
	ports[0].mu.Unlock()
	if writes != "M115\n" {
		t.Fatal("a connection test must only query firmware", writes)
	}
	if !strings.Contains(a.printing.status()["firmware"].(string), "Marlin") {
		t.Fatal(a.printing.status())
	}
	if w := call(a, "POST", "/api/print-start", `{"port":"COM8","deviceID":"serial:COM8","baud":115200,"text":"G90\nG1 X10\nM104 S0"}`); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	finishUSB(t, a, "complete")
	ports[1].mu.Lock()
	writes = strings.Join(ports[1].writes, "")
	ports[1].mu.Unlock()
	if !strings.Contains(writes, "M115\nM110 N0\nN1 G90") || !strings.Contains(writes, "N2 G1 X10") || !strings.Contains(writes, "N4 M400") {
		t.Fatal(writes)
	}
}

func TestLateBootResetRetriesOnlyIdentificationBeforeSendingPrintCommands(t *testing.T) {
	a := testApp(t)
	p := mockMarlin()
	queries := 0
	p.replies = func(s string) string {
		if strings.TrimSpace(s) == "M115" {
			queries++
			if queries == 1 {
				return "start\n"
			}
			return "FIRMWARE_NAME:Marlin\nok\n"
		}
		return "ok\n"
	}
	a.openUSB = func(string, int) (io.ReadWriteCloser, error) { return p, nil }
	if w := call(a, "POST", "/api/print-start", `{"port":"COM3","manual":true,"baud":115200,"text":"G90"}`); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	finishUSB(t, a, "complete")
	p.mu.Lock()
	writes := strings.Join(p.writes, "")
	p.mu.Unlock()
	if !strings.HasPrefix(writes, "M115\nM115\nM110 N0\nN1 G90") {
		t.Fatal(writes)
	}
}

func TestWrongDeviceAndInvalidManualPortsCannotStartPrinting(t *testing.T) {
	a := testApp(t)
	opened := false
	a.listUSB = func() ([]connectedDevice, error) { return []connectedDevice{{ID: "serial:COM8", Port: "COM8"}}, nil }
	a.openUSB = func(string, int) (io.ReadWriteCloser, error) { opened = true; return mockMarlin(), nil }
	for _, in := range []object{{"port": "COM8", "deviceID": "other", "baud": 115200}, {"port": "COM0", "manual": true, "baud": 115200}, {"port": "COM8", "manual": true, "baud": 9600}} {
		in["text"] = "G90"
		body, _ := json.Marshal(in)
		if w := call(a, "POST", "/api/print-start", string(body)); w.Code != 400 {
			t.Fatal(w.Code)
		}
	}
	if opened {
		t.Fatal("opened an unselected port")
	}
}
