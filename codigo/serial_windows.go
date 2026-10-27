package main

import (
	"io"
	"runtime"
	"syscall"
	"unsafe"
)

func serialPortNumbers() ([]uint32, error) {
	p := syscall.NewLazyDLL("kernelbase.dll").NewProc("GetCommPorts")
	if e := p.Find(); e != nil {
		return nil, e
	}
	capacity := uint32(32)
	for capacity <= 65536 {
		ports := make([]uint32, capacity)
		var found uint32
		code, _, _ := p.Call(uintptr(unsafe.Pointer(&ports[0])), uintptr(capacity), uintptr(unsafe.Pointer(&found)))
		if code == 0 {
			return ports[:found], nil
		}
		if code == 2 {
			return []uint32{}, nil
		}
		if code != 234 {
			return nil, syscall.Errno(code)
		}
		capacity = found
		if capacity < 32 {
			capacity = 64
		}
	}
	return nil, syscall.EINVAL
}

type serialPort struct{ handle syscall.Handle }
type serialDCB struct {
	Length, Baud, Flags                                                        uint32
	Reserved, XonLim, XoffLim                                                  uint16
	ByteSize, Parity, StopBits, XonChar, XoffChar, ErrorChar, EofChar, EvtChar byte
	Reserved1                                                                  uint16
}
type serialTimeouts struct{ Interval, ReadMultiplier, ReadConstant, WriteMultiplier, WriteConstant uint32 }

func openSerial(name string, baud int) (io.ReadWriteCloser, error) {
	p, e := syscall.UTF16PtrFromString(`\\.\` + name)
	if e != nil {
		return nil, e
	}
	h, e := syscall.CreateFile(p, syscall.GENERIC_READ|syscall.GENERIC_WRITE, 0, nil, syscall.OPEN_EXISTING, 0, 0)
	if e != nil {
		return nil, e
	}
	kernel := syscall.NewLazyDLL("kernel32.dll")
	fail := func(e error) (io.ReadWriteCloser, error) { syscall.CloseHandle(h); return nil, e }
	d := serialDCB{}
	d.Length = uint32(unsafe.Sizeof(d))
	if ok, _, e := kernel.NewProc("GetCommState").Call(uintptr(h), uintptr(unsafe.Pointer(&d))); ok == 0 {
		return fail(e)
	}
	d.Baud = uint32(baud)
	d.Flags = 1 | (1 << 4) | (1 << 12) // binary, DTR enabled, RTS enabled; no CTS/XON handshake.
	d.ByteSize = 8
	d.Parity = 0
	d.StopBits = 0
	d.XonChar = 17
	d.XoffChar = 19
	if ok, _, e := kernel.NewProc("SetCommState").Call(uintptr(h), uintptr(unsafe.Pointer(&d))); ok == 0 {
		return fail(e)
	}
	t := serialTimeouts{Interval: 0xffffffff, ReadConstant: 150, WriteConstant: 3000}
	if ok, _, e := kernel.NewProc("SetCommTimeouts").Call(uintptr(h), uintptr(unsafe.Pointer(&t))); ok == 0 {
		return fail(e)
	}
	kernel.NewProc("PurgeComm").Call(uintptr(h), 15)
	return &serialPort{h}, nil
}
func (s *serialPort) Read(b []byte) (int, error) {
	var n uint32
	e := syscall.ReadFile(s.handle, b, &n, nil)
	return int(n), e
}
func (s *serialPort) Write(b []byte) (int, error) {
	var n uint32
	e := syscall.WriteFile(s.handle, b, &n, nil)
	return int(n), e
}
func (s *serialPort) Close() error { return syscall.CloseHandle(s.handle) }
func preventSleep() func() {
	runtime.LockOSThread()
	p := syscall.NewLazyDLL("kernel32.dll").NewProc("SetThreadExecutionState")
	p.Call(0x80000001)
	return func() { p.Call(0x80000000); runtime.UnlockOSThread() }
}
