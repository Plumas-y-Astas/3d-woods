package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type usbRequest struct {
	Port, DeviceID, Text, Name string
	Baud                       int
	Manual                     bool
}

var errBootReset = errors.New("USB boot reset")
var errNoFirmware = errors.New("La respuesta no incluye identificación de firmware")

func (j *printJob) log(line string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.Log += line + "\n"
	if len(j.Log) > 8000 {
		j.Log = j.Log[len(j.Log)-8000:]
	}
}
func writeSerial(port io.ReadWriteCloser, line string) error {
	n, e := io.WriteString(port, line)
	if e == nil && n != len(line) {
		return io.ErrShortWrite
	}
	return e
}

func readFirmware(ctx context.Context, s *serialLines, log func(string)) (string, error) {
	firmware := ""
	for {
		line, e := s.line(ctx)
		if e != nil {
			return "", e
		}
		log("← " + line)
		lower := strings.ToLower(line)
		if strings.Contains(lower, "firmware_name:") {
			firmware = line
		}
		if lower == "start" {
			return "", errBootReset
		}
		if strings.HasPrefix(lower, "error:") || strings.Contains(lower, "unknown command") || strings.Contains(lower, "halted") {
			return "", errors.New(line)
		}
		if lower == "ok" || strings.HasPrefix(lower, "ok ") {
			if firmware == "" {
				return "", errNoFirmware
			}
			return firmware, nil
		}
	}
}

func (j *printJob) identify(ctx context.Context, s *serialLines) (string, error) {
	j.log("Puerto " + j.Port + " · esperando el arranque USB")
	boot, cancel := context.WithTimeout(ctx, 2200*time.Millisecond)
	for boot.Err() == nil {
		line, e := s.line(boot)
		if e != nil && boot.Err() == nil {
			cancel()
			return "", e
		}
		if line != "" {
			j.log("← " + line)
		}
	}
	cancel()
	s.buffer = ""
	for attempt := 1; attempt <= 3; attempt++ {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		j.log(fmt.Sprintf("→ M115 · intento %d", attempt))
		if e := writeSerial(s.port, "M115\n"); e != nil {
			return "", e
		}
		query, stop := context.WithTimeout(ctx, 2500*time.Millisecond)
		firmware, e := readFirmware(query, s, j.log)
		stop()
		if e == nil {
			j.mu.Lock()
			j.Firmware = firmware
			j.mu.Unlock()
			return firmware, nil
		}
		if e != errBootReset && e != errNoFirmware && !errors.Is(e, context.DeadlineExceeded) {
			return "", e
		}
		s.buffer = ""
	}
	return "", errors.New("Sin identificación de firmware. Revisa los baudios, el cable de datos y el controlador USB; cierra Cura u otro programa que use el puerto")
}

func (a *app) selectedUSB(in usbRequest) error {
	if !comName.MatchString(in.Port) || (in.Baud != 115200 && in.Baud != 250000 && in.Baud != 230400 && in.Baud != 57600) {
		return errors.New("Selecciona un puerto COM y velocidad compatibles")
	}
	if in.Manual {
		return nil
	}
	list := a.listUSB
	if list == nil {
		list = enumerateDevices
	}
	devices, e := list()
	if e != nil {
		return e
	}
	for _, d := range devices {
		if matchesDevice(d, in.DeviceID, in.Port) {
			return nil
		}
	}
	return errors.New("El puerto seleccionado no está presente. Actualiza USB o indica el COM que muestra el Administrador de dispositivos")
}
func (a *app) serial(in usbRequest) (io.ReadWriteCloser, error) {
	open := a.openUSB
	if open == nil {
		open = openSerial
	}
	return open(strings.ToUpper(in.Port), in.Baud)
}
func (a *app) usbTest(w http.ResponseWriter, r *http.Request) {
	var in usbRequest
	if e := readBody(w, r, &in); e != nil {
		fail(w, e)
		return
	}
	if e := a.selectedUSB(in); e != nil {
		fail(w, e)
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.printing != nil && a.printing.active() {
		fail(w, errors.New("Hay una conexión o impresión USB activa"))
		return
	}
	p, e := a.serial(in)
	if e != nil {
		fail(w, fmt.Errorf("No se pudo abrir %s: %w. Cierra programas que estén usando ese puerto", in.Port, e))
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	j := &printJob{Kind: "probe", State: "checking", Message: "Consultando firmware por USB…", Port: in.Port, cancel: cancel}
	a.printing = j
	go func() {
		defer cancel()
		defer p.Close()
		firmware, e := j.identify(ctx, &serialLines{port: p})
		if e != nil {
			if ctx.Err() != nil {
				j.update("stopped", "Prueba USB cancelada")
				return
			}
			j.update("error", e.Error())
			return
		}
		j.update("connected", "USB respondió · "+firmware)
	}()
	reply(w, object{"started": true})
}
