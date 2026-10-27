package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestVersionComparison(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"0.8.0", "0.8.0", 0},
		{"v0.8.0", "0.8.0", 0},
		{"0.8.2", "0.8.1", 1},
		{"0.7.9", "0.8.0", -1},
		{"1.0", "0.99.99", 1},
		{"0.8.0-beta.1", "0.8.0", -1},
		{"0.8.0", "0.8.0-beta.2", 1},
		{"0.8.0-beta.2", "0.8.0-beta.10", -1},
		{"0.8.0+build.4", "0.8.0", 0},
	}
	for _, c := range cases {
		got, err := compareVersions(c.a, c.b)
		if err != nil {
			t.Fatalf("%s vs %s: %v", c.a, c.b, err)
		}
		if got != c.want {
			t.Fatalf("%s vs %s: got %d, want %d", c.a, c.b, got, c.want)
		}
	}
	for _, bad := range []string{"", "v", "1.2.3.4", "uno.2.3", "1.-2.3"} {
		if _, _, err := parseVersion(bad); err == nil {
			t.Fatalf("accepted invalid version %q", bad)
		}
	}
}

func TestRepositoryNamesAreNormalized(t *testing.T) {
	cases := map[string]string{
		"plumasyastas/3d-woods":                       "plumasyastas/3d-woods",
		"https://github.com/plumasyastas/3d-woods":    "plumasyastas/3d-woods",
		"http://github.com/plumasyastas/3d-woods.git": "plumasyastas/3d-woods",
		"github.com/plumasyastas/3d-woods/":           "plumasyastas/3d-woods",
		"  plumasyastas/3d-woods  ":                   "plumasyastas/3d-woods",
	}
	for input, want := range cases {
		got, err := cleanRepo(input)
		if err != nil {
			t.Fatalf("%q: %v", input, err)
		}
		if got != want {
			t.Fatalf("%q: got %q, want %q", input, got, want)
		}
	}
	for _, bad := range []string{"solo-usuario", "dos/repos/mas", "../repos", "https://gitlab.com/a/b", "a b/c", "a/.."} {
		if got, err := cleanRepo(bad); err == nil {
			t.Fatalf("accepted %q as %q", bad, got)
		}
	}
}

func TestChecksumsAreParsedAndValidated(t *testing.T) {
	text := "# firmas\n" +
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa *otro.exe\n" +
		"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB  3D-Woods.exe\n"
	got, err := checksumFor(text, "3D-Woods.exe")
	if err != nil {
		t.Fatal(err)
	}
	if got != strings.Repeat("b", 64) {
		t.Fatalf("got %q", got)
	}
	if _, err := checksumFor(text, "falta.exe"); err == nil {
		t.Fatal("accepted a missing checksum")
	}
	if _, err := checksumFor("xyz *3D-Woods.exe\n", "3D-Woods.exe"); err == nil {
		t.Fatal("accepted an invalid checksum")
	}
}

func releaseHandler(t *testing.T, server **httptest.Server, payload []byte, sums *string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		base := (*server).URL
		switch r.URL.Path {
		case "/repos/plumasyastas/3d-woods/releases/latest":
			if r.Header.Get("Accept") != "application/vnd.github+json" {
				t.Errorf("missing GitHub accept header")
			}
			fmt.Fprintf(w, `{"tag_name":"v0.9.0","name":"0.9.0","body":"Novedades","html_url":"https://github.com/plumasyastas/3d-woods/releases/tag/v0.9.0","published_at":"2026-10-26T00:00:00Z","assets":[{"name":"3D-Woods.exe","size":%d,"browser_download_url":"%s/3D-Woods.exe"},{"name":"SHA256SUMS.txt","size":%d,"browser_download_url":"%s/SHA256SUMS.txt"}]}`, len(payload), base, len(*sums), base)
		case "/3D-Woods.exe":
			w.Write(payload)
		case "/SHA256SUMS.txt":
			fmt.Fprint(w, *sums)
		default:
			http.NotFound(w, r)
		}
	}
}

func TestReleaseFetchUsesGitHubAPIAndRequiresAssets(t *testing.T) {
	var server *httptest.Server
	payload := []byte("ejecutable de prueba")
	sums := strings.Repeat("a", 64) + " *3D-Woods.exe\n"
	server = httptest.NewServer(releaseHandler(t, &server, payload, &sums))
	defer server.Close()

	release, err := fetchReleaseWith(server.Client(), server.URL, "plumasyastas/3d-woods")
	if err != nil {
		t.Fatal(err)
	}
	if !release.Info.Available || release.Info.Latest != "0.9.0" || release.Info.Current != appVersion {
		t.Fatalf("unexpected info: %+v", release.Info)
	}
	if release.Info.Notes != "Novedades" {
		t.Fatalf("release notes were not kept: %+v", release.Info)
	}
	if release.Exe == nil || release.Sums == nil {
		t.Fatal("assets were not recognized")
	}
	if _, err := fetchReleaseWith(server.Client(), server.URL, "../privado"); err == nil {
		t.Fatal("accepted an invalid repository")
	}
}

func TestDownloadVerifiesChecksumAndRejectsTampering(t *testing.T) {
	updateAllowTestServer = true
	defer func() { updateAllowTestServer = false }()

	payload := []byte("ejecutable de prueba 3D-Woods")
	sum := sha256.Sum256(payload)
	sums := hex.EncodeToString(sum[:]) + " *3D-Woods.exe\n"
	var server *httptest.Server
	server = httptest.NewServer(releaseHandler(t, &server, payload, &sums))
	defer server.Close()

	dir := t.TempDir()
	pending, err := downloadReleaseWith(server.Client(), server.URL, "plumasyastas/3d-woods", dir)
	if err != nil {
		t.Fatal(err)
	}
	if pending.Version != "0.9.0" || pending.SHA256 != hex.EncodeToString(sum[:]) || pending.Size != int64(len(payload)) {
		t.Fatalf("unexpected pending update: %+v", pending)
	}
	got, err := os.ReadFile(pending.Path)
	if err != nil || string(got) != string(payload) {
		t.Fatalf("downloaded file mismatch: %v", err)
	}
	if err := verifyFileSHA256(pending.Path, pending.SHA256); err != nil {
		t.Fatal(err)
	}
	if err := verifyFileSHA256(pending.Path, strings.Repeat("0", 64)); err == nil {
		t.Fatal("accepted a wrong checksum")
	}

	// A checksum that does not match the asset must not leave a file behind.
	sums = strings.Repeat("0", 64) + " *3D-Woods.exe\n"
	if _, err := downloadReleaseWith(server.Client(), server.URL, "plumasyastas/3d-woods", dir); err == nil {
		t.Fatal("accepted a tampered checksum")
	}
	entries, _ := os.ReadDir(dir)
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "3D-Woods-") && entry.Name() != filepath.Base(pending.Path) {
			t.Fatalf("tampered file was kept: %s", entry.Name())
		}
	}
}

func TestNonGitHubAssetsAreRejected(t *testing.T) {
	updateAllowTestServer = false
	for _, raw := range []string{"http://github.com/a.exe", "https://evil.test/a.exe", "https://github.com.evil.test/a.exe", "file:///tmp/a.exe", ""} {
		if err := validateAssetURL(raw); err == nil {
			t.Fatalf("accepted %q", raw)
		}
	}
	for _, raw := range []string{"https://github.com/plumasyastas/3d-woods/releases/download/v0.9.0/3D-Woods.exe", "https://objects.githubusercontent.com/assets/a.exe", "https://api.github.com/repos/a/b"} {
		if err := validateAssetURL(raw); err != nil {
			t.Fatalf("rejected %q: %v", raw, err)
		}
	}
}

func TestUpdateScriptQuotesWindowsPaths(t *testing.T) {
	script, err := writeUpdateScript(`C:\Taller de Dany\3D-Woods.exe`, `C:\Temp\3D-Woods-1.exe`)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(script)
	data, err := os.ReadFile(script)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	if !strings.Contains(text, `$target = 'C:\Taller de Dany\3D-Woods.exe'`) {
		t.Fatal("target path was not quoted")
	}
	if !strings.Contains(text, "-Id "+fmt.Sprint(os.Getpid())) {
		t.Fatal("script does not wait for the app process")
	}
	if !strings.Contains(text, "Remove-Item -LiteralPath $MyInvocation.MyCommand.Path") {
		t.Fatal("script does not remove itself")
	}
}

func TestDesktopUpdateEndpointsExposeVersionAndDownload(t *testing.T) {
	t.Setenv("LocalAppData", t.TempDir())
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	updateAllowTestServer = true
	defer func() { updateAllowTestServer = false }()

	payload := []byte("contenido de la actualización")
	sum := sha256.Sum256(payload)
	sums := hex.EncodeToString(sum[:]) + " *3D-Woods.exe\n"
	var server *httptest.Server
	server = httptest.NewServer(releaseHandler(t, &server, payload, &sums))
	defer server.Close()
	oldBase := updateAPIBase
	updateAPIBase = server.URL
	defer func() { updateAPIBase = oldBase }()

	a := testApp(t)
	w := call(a, "GET", "/api/version", "")
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var version struct {
		Version   string `json:"version"`
		Publisher string `json:"publisher"`
		Repo      string `json:"repo"`
	}
	json.Unmarshal(w.Body.Bytes(), &version)
	if version.Version != appVersion || version.Publisher != appPublisher || version.Repo != updateRepo {
		t.Fatalf("unexpected version response: %+v", version)
	}

	w = call(a, "POST", "/api/update/check", `{"repo":"plumasyastas/3d-woods"}`)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var info updateInfo
	json.Unmarshal(w.Body.Bytes(), &info)
	if !info.Available || info.Latest != "0.9.0" {
		t.Fatalf("unexpected check response: %+v", info)
	}

	w = call(a, "POST", "/api/update/download", `{"repo":"plumasyastas/3d-woods"}`)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var pending pendingUpdate
	json.Unmarshal(w.Body.Bytes(), &pending)
	if pending.Version != "0.9.0" || pending.SHA256 == "" {
		t.Fatalf("unexpected download response: %+v", pending)
	}
	defer os.Remove(pending.Path)
	if err := verifyFileSHA256(pending.Path, pending.SHA256); err != nil {
		t.Fatal(err)
	}
	a.updateMu.Lock()
	stored := a.pendingUpdate
	a.updateMu.Unlock()
	if stored == nil || stored.Path != pending.Path {
		t.Fatal("the downloaded update was not kept for installation")
	}
}

func TestCleanupUpdateCacheRemovesDownloads(t *testing.T) {
	t.Setenv("LocalAppData", t.TempDir())
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	dir, err := updateCacheDir()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "3D-Woods-viejo.exe")
	if err := os.WriteFile(file, []byte("viejo"), 0600); err != nil {
		t.Fatal(err)
	}
	cleanupUpdateCache()
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatal("cached update was not removed")
	}
}
