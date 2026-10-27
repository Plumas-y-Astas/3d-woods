package main

import (
	"errors"
	"io"
)

func openSerial(name string, baud int) (io.ReadWriteCloser, error) {
	return nil, errors.New("El envío serie de esta edición requiere Windows")
}
func preventSleep() func() { return func() {} }
