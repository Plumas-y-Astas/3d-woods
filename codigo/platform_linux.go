package main

import (
	"errors"
	"os"
	"os/exec"
)

func replaceFile(src, dst string) error { return os.Rename(src, dst) }
func pickFolder() (string, error) {
	return "", errors.New("Selector nativo disponible en Windows. Define WOODS_LIBRARY en Linux.")
}
func pickExecutable() (string, error) {
	return "", errors.New("Introduce la ruta completa del laminador en Ajustes.")
}
func pickSaveFile(name string) (string, error) {
	return "", errors.New("El diálogo de guardado está disponible en Windows.")
}
func openFolder(p string) error {
	c := exec.Command("xdg-open", p)
	if e := c.Start(); e != nil {
		return e
	}
	go c.Wait()
	return nil
}
func runWindow(u string) { openFolder(u); select {} }

func enumerateDevices() ([]connectedDevice, error) {
	return []connectedDevice{}, errors.New("La detección USB requiere Windows")
}

func hideCommand(c *exec.Cmd) {}
