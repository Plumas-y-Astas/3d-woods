# Componentes de 3D-Woods 0.8.2

- **Three.js 0.180.0**, MIT: visor, cargadores y exportador. Código y licencia en `codigo/dist/vendor/three`.
- **go-webview2 / go-winloader**: código y licencias en `codigo/vendor`.
- **golang.org/x/sys**, BSD: código y licencia en `codigo/vendor`.
- **Microsoft Edge WebView2 Runtime**: componente del sistema requerido. No se incluye su instalador.
- **Laminadores externos** (Cura, PrusaSlicer, OrcaSlicer, Bambu Studio, Simplify3D u otros): no se incluyen ni se distribuyen con 3D-Woods. La app solo abre el ejecutable que configures y lee el G-code que produzca; cada programa mantiene su propia licencia.
- **JSDOM y herramientas de prueba**: declaradas en `package-lock.json`; no forman parte del ejecutable de producción.
- **goversioninfo**, MIT: herramienta de compilación que genera los metadatos y el icono de Windows (`codigo/versioninfo.json`). No se distribuye dentro del ejecutable.

## Material de referencia de CuraEngine (no ejecutado)

Desde la versión 0.7.0, 3D-Woods no incluye ni ejecuta un motor de laminado. El ejecutable no contiene CuraEngine ni carga sus bibliotecas. Los archivos de `codigo/engine/` y `codigo/third_party/CuraEngine/` se conservan únicamente como referencia técnica e historial de licencias del código anterior:

- **CuraEngine 5.13.0**, AGPL-3.0: ejecutable oficial de UltiMaker, sin modificaciones, que utilizaba la versión anterior como proceso local. El paquete `codigo/engine/windows-x64.zip` y el archivo de fuentes de la etiqueta 5.13.0 permanecen como referencia; no se cargan en tiempo de ejecución.
- **Definiciones fdmprinter y fdmextruder de Cura 5.13.0**, LGPL-3.0: JSON originales del paquete de referencia. Licencia de Cura en `codigo/third_party/CuraEngine`.
- **libArcus**, LGPL-3.0, y **oneTBB**, Apache-2.0 con LLVM exception: bibliotecas dinámicas oficiales que acompañaban al motor. Se conservan licencias y archivos de fuentes en `codigo/third_party/CuraEngine`.
- El motor también utilizaba componentes como Boost / Clipper (Boost Software License), fmt, spdlog, RapidJSON, range-v3, libpng, protobuf y Sentry native. Las licencias recopiladas y enlaces a sus fuentes se encuentran en `codigo/third_party/CuraEngine`.

Si distribuyes el paquete de fuentes completo, conserva estas licencias y archivos de referencia. Si distribuyes solo el ejecutable, no se incluye ninguno de estos componentes.

El logo vectorial, las cajas y los modelos de demostración se dibujan o generan en el código de 3D-Woods. Las marcas de terceros pertenecen a sus titulares; 3D-Woods no es un producto oficial de UltiMaker, Creality o Microsoft.
