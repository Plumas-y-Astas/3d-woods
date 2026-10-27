package main

import (
	"context"
	"io"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeSerial struct {
	mu      sync.Mutex
	data    []byte
	writes  []string
	replies func(string) string
	closed  bool
}

func (f *fakeSerial) Read(b []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return 0, io.EOF
	}
	if len(f.data) == 0 {
		return 0, nil
	}
	n := copy(b, f.data)
	f.data = f.data[n:]
	return n, nil
}
func (f *fakeSerial) Write(b []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	s := string(b)
	f.writes = append(f.writes, s)
	if f.replies != nil {
		f.data = append(f.data, []byte(f.replies(s))...)
	}
	return len(b), nil
}
func (f *fakeSerial) Close() error { f.mu.Lock(); defer f.mu.Unlock(); f.closed = true; return nil }
func TestPrintFramingAndCurrentLineResend(t *testing.T) {
	f := &fakeSerial{}
	n := 0
	f.replies = func(s string) string {
		n++
		if n == 1 {
			return "Error:checksum mismatch\nResend: 1\n"
		}
		return "ok N1\n"
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if e := sendNumbered(ctx, &serialLines{port: f}, 1, "G1 X10", nil); e != nil {
		t.Fatal(e)
	}
	if len(f.writes) != 2 || f.writes[0] != f.writes[1] {
		t.Fatal(f.writes)
	}
	if framedLine(1, "G1 X10") != "N1 G1 X10*80\n" {
		t.Fatal(framedLine(1, "G1 X10"))
	}
}
func TestPrinterRestartUnknownCommandsAndHistoricalResendsStop(t *testing.T) {
	for _, reply := range []string{"start\n", "echo:Unknown command: M600\nok\n", "Resend: 1\n", "Error:Thermal Runaway\n"} {
		f := &fakeSerial{data: []byte(reply)}
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		e := waitAck(ctx, &serialLines{port: f}, 2, nil)
		cancel()
		if e == nil || e == errResend {
			t.Fatal("failed to stop", reply, e)
		}
	}
}
func TestUSBGcodePreflightPreservesHostPauseAndRejectsFirmwareWrites(t *testing.T) {
	cmds, e := printCommands(";comment\nG90\nG1 X10 Y20 ; model\n;WOODS_HOST_PAUSE\nM104 S0")
	if e != nil || len(cmds) != 4 || cmds[2] != ";WOODS_HOST_PAUSE" {
		t.Fatal(cmds, e)
	}
	for _, text := range []string{"M997", "M500", "M28 file", "", "G1 X10\x00"} {
		if _, e := printCommands(text); e == nil {
			t.Fatal("accepted", text)
		}
	}
}
func TestClosingServerRefusesActivePrinting(t *testing.T) {
	a := testApp(t)
	a.printing = &printJob{State: "printing"}
	if w := call(a, "POST", "/api/quit", "{}"); w.Code != 400 {
		t.Fatal(w.Code)
	}
}
func TestPrintWorkerPausesAndCompletesOnlyAfterAcknowledgement(t *testing.T) {
	f := &fakeSerial{replies: func(s string) string {
		if strings.TrimSpace(s) == "M115" {
			return "FIRMWARE_NAME:Marlin Test MACHINE_TYPE:Ender\nok\n"
		}
		return "ok\n"
	}}
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	j := &printJob{State: "connecting", Total: 3, resume: make(chan struct{}, 1), cancel: cancel}
	finished := make(chan struct{})
	go func() { j.run(ctx, f, []string{"G90", ";WOODS_HOST_PAUSE", "G1 X10"}); close(finished) }()
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		if j.status()["state"] == "paused" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if j.status()["state"] != "paused" {
		t.Fatal(j.status())
	}
	j.resume <- struct{}{}
	select {
	case <-finished:
	case <-ctx.Done():
		t.Fatal("worker did not complete")
	}
	if j.status()["state"] != "complete" {
		t.Fatal(j.status())
	}
	if !strings.Contains(strings.Join(f.writes, ""), "M400") {
		t.Fatal("missing motion drain")
	}
}
