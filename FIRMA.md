# Firma e identidad de 3D-Woods

3D-Woods se publica como **Plumas y Astas Studio**. La versión 0.8.2 incluye dos capas de identidad y una de integridad:

| Capa | Qué hace | Dónde está |
| --- | --- | --- |
| Metadatos de Windows | Muestra **Plumas y Astas Studio** como editor, **3D-Woods** como producto y la versión instalada en las propiedades del `.exe` | `codigo/versioninfo.json`, compilado en el `.exe` |
| SHA-256 de la actualización | Comprueba que el archivo descargado es exactamente el que publicó el repositorio; si cambia un byte, se descarta | `SHA256SUMS.txt` de cada versión y el actualizador de la app |
| Firma Authenticode | Windows y SmartScreen pueden verificar el editor del archivo | Opcional: requiere un certificado del estudio y los secretos de GitHub |

## Lo que ya funciona sin certificado

- El ejecutable declara `CompanyName = Plumas y Astas Studio`, `ProductName = 3D-Woods` y la versión correspondiente.
- La app descarga las actualizaciones solo por HTTPS desde GitHub y rechaza cualquier dirección que salga de GitHub.
- Antes de instalar compara el SHA-256 del ejecutable con el publicado en `SHA256SUMS.txt`. También compara el resumen que declara la API de GitHub cuando está disponible.
- Si la firma no coincide, la actualización se elimina y no se instala.

Esto evita que una descarga alterada se ejecute y permite comprobar la integridad, pero **el SHA-256 no demuestra quién creó el archivo**. Un antivirus puede seguir mostrando un aviso mientras el ejecutable no tenga una firma Authenticode de confianza.

## Por qué Windows puede avisar todavía

Windows SmartScreen y algunos antivirus desconfían de ejecutables nuevos, sin firma o con pocas descargas. La reputación se construye con el tiempo y con una firma verificada. Los metadatos de editor ayudan a identificar la app, pero no sustituyen un certificado emitido por una autoridad de certificación.

Para que el editor aparezca como verificado hace falta un **certificado de firma de código Authenticode** emitido a nombre legal de Plumas y Astas Studio. No es posible crear ese certificado desde este repositorio: la autoridad de certificación valida la identidad del estudio.

## Obtener el certificado

1. Solicita un certificado de firma de código a una autoridad reconocida (DigiCert, Sectigo, GlobalSign, Certum u otra). El certificado debe incluir la extensión de firma de código y estar a nombre de **Plumas y Astas Studio**.
2. Elige **OV** (Organization Validation) si buscas costo menor y puedes esperar a construir reputación, o **EV** (Extended Validation) si necesitas reconocimiento inmediato de SmartScreen. EV suele requerir un token físico o un servicio de firma en la nube.
3. Guarda el certificado en formato `.pfx` con su contraseña. No compartas el archivo ni la contraseña; el `.pfx` es la identidad del estudio.
4. Si el proveedor entrega un token USB, configura la firma en una máquina de confianza o usa su servicio de firma en la nube. El flujo incluido está preparado para un `.pfx` en GitHub Actions.

## Configurar la firma en GitHub

En el repositorio, abre **Settings → Secrets and variables → Actions** y crea:

- `WINDOWS_PFX_BASE64`: el archivo `.pfx` convertido a Base64 en una sola línea.
- `WINDOWS_PFX_PASSWORD`: la contraseña del `.pfx`.

En PowerShell puedes convertir el certificado así:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\ruta\plumas-y-astas.pfx")) |
  Set-Clipboard
```

Pega el resultado en el secreto `WINDOWS_PFX_BASE64`. El flujo `.github/workflows/release.yml` detecta los secretos, firma con `signtool`, comprueba que la firma sea válida y solo entonces publica la versión. Si no existen los secretos, publica la versión sin firma de certificado y avisa en el registro del flujo.

La contraseña y el `.pfx` nunca deben subirse al repositorio. Añade `*.pfx`, `*.p12` y `*.snk` a `.gitignore`.

## Comprobar la firma

En Windows, después de descargar el ejecutable:

```powershell
Get-AuthenticodeSignature .\3D-Woods.exe | Format-List Status,StatusMessage,SignerCertificate
(Get-Item .\3D-Woods.exe).VersionInfo |
  Format-List CompanyName,ProductName,FileVersion,ProductVersion,LegalCopyright
Get-FileHash .\3D-Woods.exe -Algorithm SHA256
```

`Status` debe ser `Valid` y el editor debe ser **Plumas y Astas Studio**. El hash debe coincidir con `SHA256SUMS.txt` de la misma versión.

También puedes usar la interfaz de Windows: clic derecho en el `.exe` → **Propiedades → Detalles** → **Firma digital**. La pestaña **Detalles** muestra el editor y la versión.

## Si Windows Defender marca un falso positivo

1. Comprueba que el archivo venga de la versión oficial y que el SHA-256 coincida.
2. Envía el ejecutable a Microsoft desde https://www.microsoft.com/en-us/wdsi/filesubmission como archivo no deseado/falso positivo.
3. Si distribuyes el ejecutable en un ZIP, conserva el nombre `3D-Woods.exe` y el `SHA256SUMS.txt`; no lo renombres ni lo comprimas con contraseña.
4. Con una firma Authenticode válida, el estudio puede solicitar revisión a los proveedores de antivirus y construir reputación.

## Certificado autofirmado (solo pruebas)

Un certificado autofirmado sirve para probar el flujo en un equipo propio, pero **no evita SmartScreen ni los avisos de antivirus** y no debe distribuirse. Para probarlo:

```powershell
New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=Plumas y Astas Studio (pruebas)" `
  -CertStoreLocation Cert:\CurrentUser\My
```

Después puedes exportarlo a `.pfx`, firmar con `signtool` y comprobar el resultado. En los equipos de tus clientes seguirá apareciendo como editor desconocido porque no confían en tu certificado raíz.

## Resumen

- **Identidad del editor:** incluida en los metadatos de Windows.
- **Integridad de la actualización:** verificada con SHA-256 antes de instalar.
- **Firma de confianza:** requiere certificado Authenticode del estudio; el flujo de GitHub ya está preparado.
- **Datos del usuario:** siempre fuera del ejecutable; una actualización no toca cajas, inventario, ventas ni ajustes.
