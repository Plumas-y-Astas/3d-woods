package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type printJob struct {
	mu                         sync.Mutex
	State, Message, Port, Name string
	Sent, Total                int
	Kind, Firmware, Log        string
	pause                      bool
	resume                     chan struct{}
	cancel                     context.CancelFunc
}

func (j *printJob) status() object {
	j.mu.Lock()
	defer j.mu.Unlock()
	return object{"state": j.State, "message": j.Message, "sent": j.Sent, "total": j.Total, "port": j.Port, "name": j.Name, "kind": j.Kind, "firmware": j.Firmware, "log": j.Log}
}
func (j *printJob) update(state, message string) {
	j.mu.Lock()
	j.State = state
	j.Message = message
	j.mu.Unlock()
}
func (j *printJob) active() bool {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.State == "checking" || j.State == "connecting" || j.State == "printing" || j.State == "paused" || j.State == "firmware-pause"
}

var comName = regexp.MustCompile(`(?i)^COM[1-9][0-9]{0,3}$`)
var cmdStart = regexp.MustCompile(`^(?:G\d+|M\d+|T\d+)(?:\s|$)`)
var numberedLine = regexp.MustCompile(`^N\d+\s*`)
var resendLine = regexp.MustCompile(`(?i)(?:resend:\s*|^rs\s+)(\d+)`)

func printCommands(text string) ([]string, error) {
	if len(text) > 25<<20 {
		return nil, errors.New("El envío USB admite G-code de hasta 25 MB")
	}
	lines := []string{}
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r", ""), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, ";WOODS_HOST_PAUSE") {
			lines = append(lines, ";WOODS_HOST_PAUSE")
			continue
		}
		line = strings.SplitN(line, ";", 2)[0]
		line = numberedLine.ReplaceAllString(strings.TrimSpace(line), "")
		line = strings.TrimSpace(strings.SplitN(line, "*", 2)[0])
		if line == "" {
			continue
		}
		if !cmdStart.MatchString(line) || len(line) > 200 {
			return nil, errors.New("G-code no compatible con el envío Marlin por USB")
		}
		for _, ch := range line {
			if ch < 32 || ch > 126 {
				return nil, errors.New("El comando USB contiene caracteres no ASCII")
			}
		}
		cmd := strings.Fields(line)[0]
		switch cmd {
		case "M28", "M29", "M30", "M112", "M500", "M502", "M997", "M110":
			return nil, fmt.Errorf("%s no se admite dentro de una impresión USB", cmd)
		}
		lines = append(lines, line)
	}
	if len(lines) == 0 {
		return nil, errors.New("El archivo no contiene movimientos")
	}
	return lines, nil
}
func framedLine(n int, command string) string {
	s := fmt.Sprintf("N%d %s", n, command)
	var checksum byte
	for i := range s {
		checksum ^= s[i]
	}
	return fmt.Sprintf("%s*%d\n", s, checksum)
}

type serialLines struct {
	port   io.ReadWriteCloser
	buffer string
}

func (s *serialLines) line(ctx context.Context) (string, error) {
	for {
		if i := strings.IndexByte(s.buffer, '\n'); i >= 0 {
			line := strings.TrimSpace(s.buffer[:i])
			s.buffer = s.buffer[i+1:]
			return line, nil
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		default:
		}
		b := make([]byte, 512)
		n, e := s.port.Read(b)
		if e != nil {
			return "", e
		}
		if n > 0 {
			s.buffer += string(b[:n])
			if len(s.buffer) > 16000 {
				return "", errors.New("Respuesta USB demasiado grande")
			}
		} else {
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-time.After(time.Millisecond):
			}
		}
	}
}
func waitAck(ctx context.Context, s *serialLines, n int, log func(string)) error {
	for {
		line, e := s.line(ctx)
		if e != nil {
			return e
		}
		if log != nil {
			log(line)
		}
		lower := strings.ToLower(line)
		if strings.HasPrefix(lower, "ok") && (len(lower) == 2 || lower[2] == ' ') {
			return nil
		}
		if m := resendLine.FindStringSubmatch(line); m != nil {
			want, _ := strconv.Atoi(m[1])
			if want == n {
				return errResend
			}
			return fmt.Errorf("La impresora pidió la línea %d; se detuvo para evitar repetir movimientos", want)
		}
		if strings.HasPrefix(lower, "error:") && !strings.Contains(lower, "checksum") && !strings.Contains(lower, "line number") {
			return errors.New(line)
		}
		if strings.Contains(lower, "unknown command") {
			return errors.New(line)
		}
		if strings.Contains(lower, "halted") || strings.Contains(lower, "kill()") || lower == "start" {
			return errors.New("La impresora se reinició o se detuvo: " + line)
		}
	}
}

var errResend = errors.New("resend current line")

func sendNumbered(ctx context.Context, s *serialLines, n int, cmd string, log func(string)) error {
	for tries := 0; tries < 4; tries++ {
		if e := writeSerial(s.port, framedLine(n, cmd)); e != nil {
			return e
		}
		e := waitAck(ctx, s, n, log)
		if e != errResend {
			return e
		}
	}
	return errors.New("Demasiados errores de transmisión USB")
}
func (j *printJob) run(ctx context.Context, port io.ReadWriteCloser, lines []string) {
	defer port.Close()
	done := preventSleep()
	defer done()
	s := &serialLines{port: port}
	finished := false
	started := false
	defer func() {
		if started && !finished {
			io.WriteString(port, "M112\n")
		}
	}()
	if _, e := j.identify(ctx, s); e != nil {
		if ctx.Err() != nil {
			j.update("stopped", "Conexión detenida")
			return
		}
		j.update("error", e.Error())
		return
	}
	j.log("→ M110 N0")
	if e := writeSerial(port, "M110 N0\n"); e != nil {
		j.update("error", e.Error())
		return
	}
	handshake, stop := context.WithTimeout(ctx, 8*time.Second)
	err := waitAck(handshake, s, 0, j.log)
	stop()
	if err != nil {
		j.update("error", "Sin confirmación Marlin: "+err.Error())
		return
	}
	n := 1
	started = true
	j.update("printing", "Enviando comandos confirmados por USB")
	for i, cmd := range append(lines, "M400") {
		j.mu.Lock()
		paused := j.pause
		j.mu.Unlock()
		if paused || cmd == ";WOODS_HOST_PAUSE" {
			j.update("paused", "Pausa. Cambia el filamento y pulsa Continuar cuando esté preparado.")
			select {
			case <-ctx.Done():
				j.update("stopped", "Envío detenido; se solicitó M112")
				return
			case <-j.resume:
			}
			j.mu.Lock()
			j.pause = false
			j.mu.Unlock()
			j.update("printing", "Continuando impresión")
			if cmd == ";WOODS_HOST_PAUSE" {
				continue
			}
		}
		firmwarePause := strings.HasPrefix(cmd, "M600") || cmd == "M0" || strings.HasPrefix(cmd, "M0 ") || cmd == "M1"
		if firmwarePause {
			j.update("firmware-pause", "Confirma el cambio en la pantalla de la impresora")
		}
		// Temperature waits and firmware pauses may take time; the explicit stop control remains active.
		timeout := 15 * time.Minute
		if firmwarePause {
			timeout = 2 * time.Hour
		}
		ack, stop := context.WithTimeout(ctx, timeout)
		err := sendNumbered(ack, s, n, cmd, func(line string) {
			j.log("← " + line)
			if strings.Contains(line, "T:") || strings.Contains(line, "busy:") {
				j.mu.Lock()
				j.Message = line
				j.mu.Unlock()
			}
		})
		stop()
		if err != nil {
			if ctx.Err() != nil {
				j.update("stopped", "Envío detenido; se solicitó M112")
			} else {
				j.update("error", fmt.Sprintf("Línea %d (%s): %v. Revisa la impresora; no se reanuda automáticamente.", n, strings.Fields(cmd)[0], err))
			}
			return
		}
		n++
		j.mu.Lock()
		j.Sent = i + 1
		if j.Sent > j.Total {
			j.Sent = j.Total
		}
		j.State = "printing"
		j.mu.Unlock()
	}
	finished = true
	j.update("complete", "Todos los comandos y el fin de movimiento fueron confirmados")
}
func (a *app) printStart(w http.ResponseWriter, r *http.Request) {
	var in usbRequest
	if e := readBody(w, r, &in); e != nil {
		fail(w, e)
		return
	}
	if e := a.selectedUSB(in); e != nil {
		fail(w, e)
		return
	}
	commands, e := printCommands(in.Text)
	if e != nil {
		fail(w, e)
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.printing != nil && a.printing.active() {
		fail(w, errors.New("Ya hay una impresión USB activa"))
		return
	}
	p, e := a.serial(in)
	if e != nil {
		fail(w, fmt.Errorf("No se pudo abrir %s. Cierra Cura u otro programa que use ese puerto: %w", in.Port, e))
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	j := &printJob{Kind: "print", State: "connecting", Message: fmt.Sprintf("Conectando %s a %d baudios…", in.Port, in.Baud), Port: in.Port, Name: in.Name, Total: len(commands), cancel: cancel, resume: make(chan struct{}, 1)}
	a.printing = j
	go j.run(ctx, p, commands)
	reply(w, object{"started": true})
}
func (a *app) printStatus(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	j := a.printing
	a.mu.Unlock()
	if j == nil {
		reply(w, object{"state": "idle"})
		return
	}
	reply(w, j.status())
}
func (a *app) printControl(w http.ResponseWriter, r *http.Request) {
	var in struct{ Action string }
	if e := readBody(w, r, &in); e != nil {
		fail(w, e)
		return
	}
	a.mu.Lock()
	j := a.printing
	a.mu.Unlock()
	if j == nil || !j.active() {
		fail(w, errors.New("No hay impresión activa"))
		return
	}
	switch in.Action {
	case "stop":
		j.cancel()
	case "pause":
		j.mu.Lock()
		j.pause = true
		j.Message = "Pausa solicitada tras confirmar el comando actual"
		j.mu.Unlock()
	case "resume":
		j.mu.Lock()
		paused := j.State == "paused"
		j.mu.Unlock()
		if !paused {
			fail(w, errors.New("Confirma las pausas del firmware en la impresora"))
			return
		}
		select {
		case j.resume <- struct{}{}:
		default:
		}
	default:
		fail(w, errors.New("Acción inválida"))
		return
	}
	reply(w, object{"accepted": true})
}
