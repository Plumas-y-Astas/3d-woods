package main

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// La versión se puede sustituir al compilar con -X main.appVersion=...
var appVersion = "0.8.2"

const (
	appPublisher    = "Plumas y Astas Studio"
	updateRepo      = "plumasyastas/3d-woods"
	updateAssetName = "3D-Woods.exe"
	updateSumsName  = "SHA256SUMS.txt"
	maxUpdateBytes  = 200 << 20
	maxUpdateText   = 2 << 20
)

// Solo las pruebas locales lo activan para usar httptest con HTTP.
var updateAllowTestServer bool
var updateAPIBase = "https://api.github.com"

var updateRepoPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)

var updateHTTP = &http.Client{
	Timeout: 3 * time.Minute,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if req.URL.Scheme != "https" {
			return errors.New("La actualización debe usar HTTPS")
		}
		if !allowedUpdateHost(req.URL.Hostname()) {
			return errors.New("La actualización intentó salir de GitHub")
		}
		if len(via) >= 10 {
			return errors.New("Demasiadas redirecciones al descargar la actualización")
		}
		return nil
	},
}

type githubAsset struct {
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	URL    string `json:"browser_download_url"`
	Digest string `json:"digest"`
}

type githubRelease struct {
	Tag       string        `json:"tag_name"`
	Name      string        `json:"name"`
	Body      string        `json:"body"`
	URL       string        `json:"html_url"`
	Published string        `json:"published_at"`
	Assets    []githubAsset `json:"assets"`
}

type updateInfo struct {
	Current   string `json:"current"`
	Latest    string `json:"latest"`
	Available bool   `json:"available"`
	Notes     string `json:"notes"`
	URL       string `json:"url"`
	Published string `json:"published_at"`
	Size      int64  `json:"size"`
}

type updateRelease struct {
	Info updateInfo
	Exe  *githubAsset
	Sums *githubAsset
}

type pendingUpdate struct {
	Version string `json:"version"`
	Path    string `json:"path"`
	SHA256  string `json:"sha256"`
	Size    int64  `json:"size"`
	Notes   string `json:"notes"`
	URL     string `json:"url"`
}

func (a *app) versionInfo(w http.ResponseWriter, r *http.Request) {
	reply(w, object{"version": appVersion, "publisher": appPublisher, "repo": updateRepo, "platform": runtime.GOOS})
}

func cleanRepo(value string) (string, error) {
	repo := strings.TrimSpace(value)
	if repo == "" {
		repo = updateRepo
	}
	for _, prefix := range []string{"https://github.com/", "http://github.com/", "github.com/"} {
		if strings.HasPrefix(strings.ToLower(repo), prefix) {
			repo = repo[len(prefix):]
			break
		}
	}
	repo = strings.TrimSuffix(repo, ".git")
	repo = strings.Trim(repo, "/")
	if repo == "" || len(repo) > 200 || !updateRepoPattern.MatchString(repo) {
		return "", errors.New("Usa el formato usuario/repositorio de GitHub")
	}
	for _, part := range strings.Split(repo, "/") {
		if part == "." || part == ".." {
			return "", errors.New("El repositorio de GitHub no es válido")
		}
	}
	return repo, nil
}

func parseVersion(value string) ([3]int, []string, error) {
	var numbers [3]int
	version := strings.TrimSpace(value)
	version = strings.TrimPrefix(strings.TrimPrefix(version, "v"), "V")
	if i := strings.IndexByte(version, '+'); i >= 0 {
		version = version[:i]
	}
	var pre []string
	if i := strings.IndexByte(version, '-'); i >= 0 {
		pre = strings.Split(version[i+1:], ".")
		version = version[:i]
	}
	if version == "" {
		return numbers, nil, errors.New("Versión vacía")
	}
	parts := strings.Split(version, ".")
	if len(parts) > 3 {
		return numbers, nil, fmt.Errorf("Versión no válida: %s", value)
	}
	for i, part := range parts {
		n, err := strconv.Atoi(part)
		if err != nil || n < 0 {
			return numbers, nil, fmt.Errorf("Versión no válida: %s", value)
		}
		numbers[i] = n
	}
	return numbers, pre, nil
}

func compareVersions(a, b string) (int, error) {
	an, ap, err := parseVersion(a)
	if err != nil {
		return 0, err
	}
	bn, bp, err := parseVersion(b)
	if err != nil {
		return 0, err
	}
	for i := 0; i < 3; i++ {
		if an[i] < bn[i] {
			return -1, nil
		}
		if an[i] > bn[i] {
			return 1, nil
		}
	}
	if len(ap) == 0 && len(bp) == 0 {
		return 0, nil
	}
	if len(ap) == 0 {
		return 1, nil
	}
	if len(bp) == 0 {
		return -1, nil
	}
	for i := 0; i < len(ap) && i < len(bp); i++ {
		if ap[i] == bp[i] {
			continue
		}
		an, aerr := strconv.Atoi(ap[i])
		bn, berr := strconv.Atoi(bp[i])
		switch {
		case aerr == nil && berr == nil:
			if an < bn {
				return -1, nil
			}
			return 1, nil
		case aerr == nil:
			return -1, nil
		case berr == nil:
			return 1, nil
		default:
			if ap[i] < bp[i] {
				return -1, nil
			}
			return 1, nil
		}
	}
	if len(ap) < len(bp) {
		return -1, nil
	}
	if len(ap) > len(bp) {
		return 1, nil
	}
	return 0, nil
}

func checksumFor(text, name string) (string, error) {
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		file := strings.TrimPrefix(fields[1], "*")
		if !strings.EqualFold(path.Base(file), path.Base(name)) {
			continue
		}
		sum := strings.ToLower(fields[0])
		if len(sum) != sha256.Size*2 {
			return "", fmt.Errorf("La firma SHA-256 de %s no es válida", name)
		}
		if _, err := hex.DecodeString(sum); err != nil {
			return "", fmt.Errorf("La firma SHA-256 de %s no es válida", name)
		}
		return sum, nil
	}
	return "", fmt.Errorf("No se encontró la firma SHA-256 de %s", name)
}

func allowedUpdateHost(host string) bool {
	if updateAllowTestServer {
		return true
	}
	h := strings.ToLower(strings.TrimSuffix(host, "."))
	return h == "github.com" || h == "api.github.com" ||
		h == "objects.githubusercontent.com" || h == "release-assets.githubusercontent.com" ||
		strings.HasSuffix(h, ".github.com") || strings.HasSuffix(h, ".githubusercontent.com")
}

func validateAssetURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || (u.Scheme != "https" && !updateAllowTestServer) {
		return errors.New("La actualización tiene una dirección no válida")
	}
	if !allowedUpdateHost(u.Hostname()) {
		return errors.New("La actualización no proviene de GitHub")
	}
	return nil
}

func fetchRelease(repo string) (*updateRelease, error) {
	return fetchReleaseWith(updateHTTP, updateAPIBase, repo)
}

func fetchReleaseWith(client *http.Client, apiBase, repo string) (*updateRelease, error) {
	repo, err := cleanRepo(repo)
	if err != nil {
		return nil, err
	}
	endpoint := strings.TrimRight(apiBase, "/") + "/repos/" + repo + "/releases/latest"
	req, err := http.NewRequest("GET", endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "3D-Woods-Updater/"+appVersion)
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	resp, err := client.Do(req)
	if err != nil {
		return nil, errors.New("No se pudo conectar con GitHub. Revisa tu conexión a internet")
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusNotFound:
		return nil, errors.New("El repositorio no tiene versiones publicadas todavía")
	case http.StatusForbidden, http.StatusTooManyRequests:
		return nil, errors.New("GitHub limitó las consultas. Inténtalo más tarde")
	default:
		return nil, fmt.Errorf("GitHub respondió con el código %d", resp.StatusCode)
	}
	var release githubRelease
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxUpdateText)).Decode(&release); err != nil {
		return nil, errors.New("GitHub devolvió una respuesta que no se pudo leer")
	}
	latest := strings.TrimSpace(release.Tag)
	if latest == "" {
		return nil, errors.New("La versión publicada no tiene etiqueta")
	}
	cmp, err := compareVersions(latest, appVersion)
	if err != nil {
		return nil, err
	}
	info := updateInfo{
		Current:   appVersion,
		Latest:    strings.TrimPrefix(strings.TrimPrefix(latest, "v"), "V"),
		Available: cmp > 0,
		Notes:     limitText(release.Body, 20000),
		URL:       release.URL,
		Published: release.Published,
	}
	result := &updateRelease{Info: info}
	for i := range release.Assets {
		asset := &release.Assets[i]
		switch {
		case strings.EqualFold(asset.Name, updateAssetName):
			result.Exe = asset
			info.Size = asset.Size
		case strings.EqualFold(asset.Name, updateSumsName):
			result.Sums = asset
		}
	}
	if info.Available {
		if result.Exe == nil {
			return nil, fmt.Errorf("La versión %s no incluye %s", info.Latest, updateAssetName)
		}
		if result.Sums == nil {
			return nil, fmt.Errorf("La versión %s no incluye %s", info.Latest, updateSumsName)
		}
	}
	return result, nil
}

func limitText(text string, max int) string {
	runes := []rune(text)
	if len(runes) <= max {
		return text
	}
	return string(runes[:max]) + "\n…"
}

func updateCacheDir() (string, error) {
	base, err := os.UserCacheDir()
	if err != nil || base == "" {
		base = os.TempDir()
	}
	return filepath.Join(base, "3D-Woods", "updates"), nil
}

func downloadRelease(repo, dir string) (*pendingUpdate, error) {
	return downloadReleaseWith(updateHTTP, updateAPIBase, repo, dir)
}

func downloadReleaseWith(client *http.Client, apiBase, repo, dir string) (*pendingUpdate, error) {
	release, err := fetchReleaseWith(client, apiBase, repo)
	if err != nil {
		return nil, err
	}
	if !release.Info.Available {
		return nil, fmt.Errorf("Ya tienes la última versión (%s)", appVersion)
	}
	if release.Exe == nil || release.Sums == nil {
		return nil, errors.New("La versión publicada no incluye el ejecutable y sus firmas")
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, fmt.Errorf("No se pudo preparar la carpeta de actualizaciones: %w", err)
	}
	sums, err := downloadTextWith(client, release.Sums.URL, maxUpdateText)
	if err != nil {
		return nil, fmt.Errorf("No se pudo descargar %s: %w", updateSumsName, err)
	}
	want, err := checksumFor(sums, release.Exe.Name)
	if err != nil {
		return nil, err
	}
	file, size, got, err := downloadToFileWith(client, release.Exe.URL, dir)
	if err != nil {
		return nil, err
	}
	if release.Exe.Size > 0 && size != release.Exe.Size {
		os.Remove(file)
		return nil, errors.New("El tamaño de la actualización no coincide con el publicado")
	}
	if subtle.ConstantTimeCompare([]byte(got), []byte(want)) != 1 {
		os.Remove(file)
		return nil, errors.New("La firma SHA-256 de la actualización no coincide")
	}
	if digest := strings.TrimPrefix(strings.ToLower(release.Exe.Digest), "sha256:"); digest != "" && digest != got {
		os.Remove(file)
		return nil, errors.New("La firma de GitHub de la actualización no coincide")
	}
	return &pendingUpdate{
		Version: release.Info.Latest,
		Path:    file,
		SHA256:  got,
		Size:    size,
		Notes:   release.Info.Notes,
		URL:     release.Info.URL,
	}, nil
}

func downloadTextWith(client *http.Client, rawURL string, limit int64) (string, error) {
	if err := validateAssetURL(rawURL); err != nil {
		return "", err
	}
	req, err := http.NewRequest("GET", rawURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "3D-Woods-Updater/"+appVersion)
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("GitHub respondió con el código %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return "", err
	}
	if int64(len(body)) > limit {
		return "", errors.New("El archivo de firmas es demasiado grande")
	}
	return string(body), nil
}

func downloadToFileWith(client *http.Client, rawURL, dir string) (string, int64, string, error) {
	if err := validateAssetURL(rawURL); err != nil {
		return "", 0, "", err
	}
	req, err := http.NewRequest("GET", rawURL, nil)
	if err != nil {
		return "", 0, "", err
	}
	req.Header.Set("User-Agent", "3D-Woods-Updater/"+appVersion)
	resp, err := client.Do(req)
	if err != nil {
		return "", 0, "", errors.New("No se pudo descargar la actualización")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", 0, "", fmt.Errorf("GitHub respondió con el código %d", resp.StatusCode)
	}
	if resp.ContentLength > maxUpdateBytes {
		return "", 0, "", errors.New("La actualización supera el tamaño máximo permitido")
	}
	out, err := os.CreateTemp(dir, "3D-Woods-*.exe")
	if err != nil {
		return "", 0, "", err
	}
	name := out.Name()
	ok := false
	defer func() {
		if !ok {
			os.Remove(name)
		}
	}()
	hash := sha256.New()
	n, err := io.Copy(io.MultiWriter(out, hash), io.LimitReader(resp.Body, maxUpdateBytes+1))
	if err != nil {
		out.Close()
		return "", 0, "", err
	}
	if n > maxUpdateBytes {
		out.Close()
		return "", 0, "", errors.New("La actualización supera el tamaño máximo permitido")
	}
	if err := out.Sync(); err != nil {
		out.Close()
		return "", 0, "", err
	}
	if err := out.Close(); err != nil {
		return "", 0, "", err
	}
	ok = true
	return name, n, hex.EncodeToString(hash.Sum(nil)), nil
}

func (a *app) updateCheck(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Repo string `json:"repo"`
	}
	if err := readBody(w, r, &req); err != nil {
		fail(w, err)
		return
	}
	release, err := fetchRelease(req.Repo)
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, release.Info)
}

func (a *app) updateDownload(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Repo string `json:"repo"`
	}
	if err := readBody(w, r, &req); err != nil {
		fail(w, err)
		return
	}
	dir, err := updateCacheDir()
	if err != nil {
		fail(w, err)
		return
	}
	pending, err := downloadRelease(req.Repo, dir)
	if err != nil {
		fail(w, err)
		return
	}
	a.updateMu.Lock()
	previous := a.pendingUpdate
	a.pendingUpdate = pending
	a.updateMu.Unlock()
	if previous != nil && previous.Path != pending.Path {
		os.Remove(previous.Path)
	}
	reply(w, pending)
}

func (a *app) updateInstall(w http.ResponseWriter, r *http.Request) {
	if runtime.GOOS != "windows" {
		fail(w, errors.New("La actualización automática solo está disponible en Windows"))
		return
	}
	a.updateMu.Lock()
	pending := a.pendingUpdate
	a.updateMu.Unlock()
	if pending == nil {
		fail(w, errors.New("Primero descarga una actualización"))
		return
	}
	cmp, err := compareVersions(pending.Version, appVersion)
	if err != nil || cmp <= 0 {
		fail(w, errors.New("La actualización descargada ya no es más reciente"))
		return
	}
	a.mu.Lock()
	active := a.printing != nil && a.printing.active()
	a.mu.Unlock()
	if active {
		fail(w, errors.New("Hay una impresión USB activa. Finalízala o detenla antes de actualizar"))
		return
	}
	if err := verifyFileSHA256(pending.Path, pending.SHA256); err != nil {
		fail(w, err)
		return
	}
	exe, err := os.Executable()
	if err != nil {
		fail(w, err)
		return
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	if err := ensureWritableDir(filepath.Dir(exe)); err != nil {
		fail(w, errors.New("La carpeta de la aplicación no permite escribir. Mueve 3D-Woods a una carpeta tuya o ejecútala como administrador"))
		return
	}
	script, err := writeUpdateScript(exe, pending.Path)
	if err != nil {
		fail(w, err)
		return
	}
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", script)
	hideCommand(cmd)
	if err := cmd.Start(); err != nil {
		os.Remove(script)
		fail(w, err)
		return
	}
	go cmd.Wait()
	reply(w, object{"installing": true, "version": pending.Version})
}

func verifyFileSHA256(file, want string) error {
	f, err := os.Open(file)
	if err != nil {
		return errors.New("La actualización descargada ya no está disponible")
	}
	defer f.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, f); err != nil {
		return err
	}
	got := hex.EncodeToString(hash.Sum(nil))
	if subtle.ConstantTimeCompare([]byte(got), []byte(strings.ToLower(want))) != 1 {
		return errors.New("La firma SHA-256 de la actualización no coincide")
	}
	return nil
}

func ensureWritableDir(dir string) error {
	f, err := os.CreateTemp(dir, ".woods-update-*")
	if err != nil {
		return err
	}
	name := f.Name()
	if err := f.Close(); err != nil {
		os.Remove(name)
		return err
	}
	return os.Remove(name)
}

func psQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func writeUpdateScript(exe, downloaded string) (string, error) {
	script := fmt.Sprintf(`$ErrorActionPreference = 'Stop'
$target = %s
$download = %s
$backup = %s
try {
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Process -Id %d -ErrorAction SilentlyContinue) -and ((Get-Date) -lt $deadline)) {
    Start-Sleep -Milliseconds 250
  }
  Start-Sleep -Milliseconds 900
  if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue }
  Move-Item -LiteralPath $target -Destination $backup -Force
  Copy-Item -LiteralPath $download -Destination $target -Force
  Start-Process -FilePath $target -WorkingDirectory (Split-Path -Parent $target)
  Start-Sleep -Seconds 2
  Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $download -Force -ErrorAction SilentlyContinue
} catch {
  if ((!(Test-Path -LiteralPath $target)) -and (Test-Path -LiteralPath $backup)) {
    Move-Item -LiteralPath $backup -Destination $target -Force
  }
  if (Test-Path -LiteralPath $target) {
    Start-Process -FilePath $target -WorkingDirectory (Split-Path -Parent $target)
  }
}
Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue
`, psQuote(exe), psQuote(downloaded), psQuote(exe+".old"), os.Getpid())
	f, err := os.CreateTemp("", "3d-woods-update-*.ps1")
	if err != nil {
		return "", err
	}
	path := f.Name()
	if _, err := io.WriteString(f, script); err != nil {
		f.Close()
		os.Remove(path)
		return "", err
	}
	if err := f.Close(); err != nil {
		os.Remove(path)
		return "", err
	}
	return path, nil
}

func cleanupUpdateCache() {
	if dir, err := updateCacheDir(); err == nil {
		if entries, err := os.ReadDir(dir); err == nil {
			for _, entry := range entries {
				if !entry.IsDir() {
					os.Remove(filepath.Join(dir, entry.Name()))
				}
			}
		}
	}
	if exe, err := os.Executable(); err == nil {
		os.Remove(exe + ".old")
	}
}
