package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type connectedDevice struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Port       string `json:"port"`
	Status     string `json:"status"`
	HardwareID string `json:"hardwareId,omitempty"`
}

func mergeSerialDevices(ports []uint32, details []connectedDevice) []connectedDevice {
	out := []connectedDevice{}
	seen := map[string]bool{}
	for _, d := range details {
		d.Port = strings.ToUpper(d.Port)
		if d.Port != "" {
			if seen[d.Port] {
				continue
			}
			seen[d.Port] = true
			d.HardwareID = d.ID
			d.ID = "serial:" + d.Port
		}
		out = append(out, d)
	}
	for _, n := range ports {
		port := fmt.Sprintf("COM%d", n)
		if n > 0 && !seen[port] {
			out = append(out, connectedDevice{ID: "serial:" + port, Name: "Puerto serie " + port, Port: port, Status: "OK"})
			seen[port] = true
		}
	}
	return out
}

func matchesDevice(d connectedDevice, id, port string) bool {
	return strings.EqualFold(d.Port, port) && (strings.EqualFold(d.ID, id) || (d.HardwareID != "" && strings.EqualFold(d.HardwareID, id)))
}

type printerProbe struct {
	ID         string `json:"id"`
	Connection string `json:"connection"`
	DeviceID   string `json:"deviceId"`
	Host       string `json:"host"`
	Port       int    `json:"port"`
}
type connectionResult struct {
	Connected bool   `json:"connected"`
	Message   string `json:"message"`
}

func localAddress(ip net.IP) bool {
	p, ok := netip.AddrFromSlice(ip)
	if !ok {
		return false
	}
	p = p.Unmap()
	return p.IsPrivate() || p.IsLoopback() || p.IsLinkLocalUnicast()
}
func probeNetwork(ctx context.Context, host string, port int) connectionResult {
	if port < 1 || port > 65535 || host == "" || strings.ContainsAny(host, "/\\@ \t\r\n") {
		return connectionResult{false, "Configura una IP o nombre y un puerto válidos"}
	}
	ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
	if err != nil || len(ips) == 0 {
		return connectionResult{false, "No se encuentra el equipo en la red"}
	}
	for _, ip := range ips {
		if !localAddress(ip) {
			continue
		}
		d := net.Dialer{Timeout: 1200 * time.Millisecond}
		c, e := d.DialContext(ctx, "tcp", net.JoinHostPort(ip.String(), strconv.Itoa(port)))
		if e == nil {
			c.Close()
			return connectionResult{true, "Red disponible · puerto accesible"}
		}
	}
	return connectionResult{false, "Sin respuesta · revisa red, puerto o firewall"}
}
func (a *app) printerStatus(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Printers []printerProbe `json:"printers"`
	}
	if e := readBody(w, r, &in); e != nil {
		fail(w, e)
		return
	}
	if len(in.Printers) > 32 {
		fail(w, errors.New("Máximo 32 impresoras por comprobación"))
		return
	}
	devices, deviceErr := enumerateDevices()
	if devices == nil {
		devices = []connectedDevice{}
	}
	results := map[string]connectionResult{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	slots := make(chan struct{}, 8)
	for _, p := range in.Printers {
		wg.Add(1)
		go func(p printerProbe) {
			defer wg.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			result := connectionResult{false, "Sin conexión configurada"}
			switch p.Connection {
			case "usb":
				if p.DeviceID == "" {
					result.Message = "Asocia un dispositivo USB"
				} else if deviceErr != nil {
					result.Message = "No se pudo consultar los dispositivos de Windows"
				} else {
					result.Message = "USB desconectado"
					for _, d := range devices {
						if strings.EqualFold(d.ID, p.DeviceID) || strings.EqualFold(d.HardwareID, p.DeviceID) && d.HardwareID != "" {
							result = connectionResult{true, "USB presente · " + d.Port}
							if d.Status != "OK" {
								result.Message = "USB presente · Windows informa " + d.Status
							}
							break
						}
					}
				}
			case "network":
				ctx, cancel := context.WithTimeout(r.Context(), 2500*time.Millisecond)
				result = probeNetwork(ctx, p.Host, p.Port)
				cancel()
			}
			mu.Lock()
			results[p.ID] = result
			mu.Unlock()
		}(p)
	}
	wg.Wait()
	note := ""
	if deviceErr != nil {
		note = "No se pudieron enumerar los puertos USB."
	}
	reply(w, object{"devices": devices, "statuses": results, "note": note, "checkedAt": time.Now().Format(time.RFC3339)})
}
func (a *app) trashBox(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	var in struct {
		ID     string `json:"id"`
		Folder string `json:"folder"`
	}
	if e := readBody(w, r, &in); e != nil {
		fail(w, e)
		return
	}
	if in.Folder == "" || strings.HasPrefix(in.Folder, ".") || strings.ContainsAny(in.Folder, "/\\") {
		fail(w, errors.New("Selecciona una carpeta de caja válida"))
		return
	}
	src, e := a.inside(in.Folder)
	if e != nil {
		fail(w, e)
		return
	}
	st, e := os.Lstat(src)
	if e != nil || !st.IsDir() || st.Mode()&os.ModeSymlink != 0 {
		fail(w, errors.New("La caja ya no está disponible"))
		return
	}
	meta, e := readObject(filepath.Join(src, ".3dwoods.json"))
	if e != nil || str(meta, "id") != in.ID {
		fail(w, errors.New("La identidad de la carpeta cambió; sincroniza antes de eliminar"))
		return
	}
	state, e := a.load()
	if e != nil {
		fail(w, e)
		return
	}
	if state == nil {
		fail(w, errors.New("Guarda el catálogo antes de eliminar"))
		return
	}
	dst, e := a.inside(filepath.ToSlash(filepath.Join(".3dwoods-papelera", identifier()+"-"+in.Folder)))
	if e != nil {
		fail(w, e)
		return
	}
	if e = os.MkdirAll(filepath.Dir(dst), 0700); e != nil {
		fail(w, e)
		return
	}
	if e = os.Rename(src, dst); e != nil {
		fail(w, e)
		return
	}
	if all, ok := state["boxes"].([]any); ok {
		kept := []any{}
		for _, v := range all {
			b, ok := v.(map[string]any)
			if !ok || str(b, "id") != in.ID {
				kept = append(kept, v)
			}
		}
		state["boxes"] = kept
	}
	if e = atomicJSON(filepath.Join(a.root, ".3dwoods-library.json"), state); e != nil {
		rollback := os.Rename(dst, src)
		fail(w, fmt.Errorf("No se pudo guardar la eliminación: %v (reversión: %v)", e, rollback))
		return
	}
	reply(w, object{"removed": true, "trash": dst})
}
