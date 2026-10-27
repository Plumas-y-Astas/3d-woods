package main

import (
	"context"
	"encoding/json"
	"github.com/jchv/go-webview2"
	"github.com/jchv/go-webview2/webviewloader"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

func replaceFile(src, dst string) error {
	a, e := syscall.UTF16PtrFromString(src)
	if e != nil {
		return e
	}
	b, e := syscall.UTF16PtrFromString(dst)
	if e != nil {
		return e
	}
	p := syscall.NewLazyDLL("kernel32.dll").NewProc("MoveFileExW")
	ok, _, err := p.Call(uintptr(unsafe.Pointer(a)), uintptr(unsafe.Pointer(b)), 9)
	if ok == 0 {
		return err
	}
	return nil
}
func powershell(script string) (string, error) {
	c := exec.Command("powershell.exe", "-NoProfile", "-STA", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); "+script)
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	b, e := c.Output()
	return strings.TrimSpace(string(b)), e
}
func pickFolder() (string, error) {
	return powershell(`Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='Selecciona la carpeta de tu estantería 3D-Woods'; if($d.ShowDialog() -eq 'OK'){[Console]::Write($d.SelectedPath)}`)
}
func pickExecutable() (string, error) {
	return powershell(`Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Title='Selecciona tu programa laminador'; $d.Filter='Aplicaciones (*.exe)|*.exe'; if($d.ShowDialog() -eq 'OK'){[Console]::Write($d.FileName)}`)
}
func pickSaveFile(name string) (string, error) {
	script := `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.SaveFileDialog; $d.Title='Guardar archivo de 3D-Woods'; $d.FileName=$env:WOODS_SAVE_FILENAME; $d.Filter='Todos los archivos (*.*)|*.*'; $d.OverwritePrompt=$true; if($d.ShowDialog() -eq 'OK'){[Console]::Write($d.FileName)}`
	c := exec.Command("powershell.exe", "-NoProfile", "-STA", "-Command", script)
	c.Env = append(os.Environ(), "WOODS_SAVE_FILENAME="+name)
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	b, e := c.Output()
	return strings.TrimSpace(string(b)), e
}
func openFolder(p string) error {
	c := exec.Command("explorer.exe", p)
	if e := c.Start(); e != nil {
		return e
	}
	go c.Wait()
	return nil
}
func nativeMessage(text string) {
	title, _ := syscall.UTF16PtrFromString("3D-Woods")
	body, _ := syscall.UTF16PtrFromString(text)
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(body)), uintptr(unsafe.Pointer(title)), 0x40)
}
func runWindow(u string) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	kernel := syscall.NewLazyDLL("kernel32.dll")
	user := syscall.NewLazyDLL("user32.dll")
	mutexName, _ := syscall.UTF16PtrFromString(`Local\3DWoodsDesktop`)
	mutex, _, err := kernel.NewProc("CreateMutexW").Call(0, 0, uintptr(unsafe.Pointer(mutexName)))
	if mutex != 0 {
		defer syscall.CloseHandle(syscall.Handle(mutex))
	}
	if err == syscall.Errno(183) {
		title, _ := syscall.UTF16PtrFromString("3D-Woods · Mi taller")
		h, _, _ := user.NewProc("FindWindowW").Call(0, uintptr(unsafe.Pointer(title)))
		if h != 0 {
			user.NewProc("ShowWindow").Call(h, 9)
			user.NewProc("SetForegroundWindow").Call(h)
		}
		return
	}
	if v, e := webviewloader.GetInstalledVersion(); e != nil || v == "" {
		nativeMessage("Para mostrar su ventana, 3D-Woods necesita Microsoft Edge WebView2 Runtime. No se encontró instalado.\n\nInstala ese componente de Microsoft y vuelve a abrir la aplicación. Después funciona sin conexión; tus modelos y datos permanecen en tu equipo.")
		return
	}
	cfg, _ := os.UserConfigDir()
	w := webview2.NewWithOptions(webview2.WebViewOptions{Debug: false, AutoFocus: true, DataPath: filepath.Join(cfg, "3D-Woods", "interfaz"), WindowOptions: webview2.WindowOptions{Title: "3D-Woods · Mi taller", Width: 1480, Height: 960, IconId: 1, Center: true}})
	if w == nil {
		nativeMessage("No se pudo iniciar la ventana de 3D-Woods. Comprueba que WebView2 Runtime esté instalado y actualizado.")
		return
	}
	defer w.Destroy()
	w.SetSize(850, 600, webview2.HintMin)
	w.Bind("woodsCloseReady", func() { w.Dispatch(func() { w.Terminate() }) })
	oldProc := uintptr(0)
	closing := false
	setProc := user.NewProc("SetWindowLongPtrW")
	callProc := user.NewProc("CallWindowProcW")
	callback := syscall.NewCallback(func(hwnd uintptr, msg uint32, wp, lp uintptr) uintptr {
		if msg == 0x10 {
			if !closing {
				closing = true
				w.Dispatch(func() {
					w.Eval("(async()=>{try{if(window.woodsBeforeClose)await window.woodsBeforeClose();await window.woodsCloseReady()}catch(e){window.alert('No se pudo guardar: '+e.message);await window.woodsCancelClose()}})()")
				})
			}
			return 0
		}
		r, _, _ := callProc.Call(oldProc, hwnd, uintptr(msg), wp, lp)
		return r
	})
	w.Bind("woodsCancelClose", func() { closing = false })
	oldProc, _, _ = setProc.Call(uintptr(w.Window()), ^uintptr(3), callback)
	w.Navigate(u)
	w.Run()
}

// Enumerate presence only. Never open COM ports (Cura may own them, and DTR can reset a printer).
func enumerateDevices() ([]connectedDevice, error) {
	ports, portError := serialPortNumbers()
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	script := `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); $ErrorActionPreference='Stop'; $items=@(Get-PnpDevice -PresentOnly | Where-Object { $_.Class -eq 'Ports' -or $_.InstanceId -like 'USBPRINT\*' } | ForEach-Object { $port=''; if($_.FriendlyName -match '\((COM\d+)\)'){$port=$Matches[1]}; @{id=$_.InstanceId;name=$_.FriendlyName;port=$port;status=$_.Status} }); ConvertTo-Json -InputObject $items -Compress`
	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, e := cmd.Output()
	if e != nil {
		if portError == nil {
			return mergeSerialDevices(ports, nil), nil
		}
		return nil, e
	}
	var devices []connectedDevice
	e = json.Unmarshal(out, &devices)
	if e != nil && portError != nil {
		return nil, e
	}
	return mergeSerialDevices(ports, devices), nil
}

func hideCommand(c *exec.Cmd) { c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true} }
