# Motor de referencia: procedencia y fuentes

CuraEngine 5.13.0 para Windows x64, extraído sin modificar de:
https://github.com/Ultimaker/Cura/releases/download/5.13.0/UltiMaker-Cura-5.13.0-win64-X64.exe

SHA256 del instalador oficial:
`6edb3c4394e6e4ecb6b00f3e96d70e1ea53652c57a9626b58f8fda56e291aa6d`

El paquete mínimo de `engine/windows-x64.zip` incluye CuraEngine.exe, sus DLL importadas disponibles en esa distribución y las dos definiciones genéricas de la misma versión. `files.json` registra el hash de cada archivo. `engine/runtime.json` registra el hash del paquete completo. No se incluye la interfaz de Cura.

Fuentes CuraEngine: `CuraEngine-5.13.0.tar.gz`, etiqueta 5.13.0, commit `636f9608621fd1d6c1b75ad2a969de53beabfbc6`.
https://github.com/Ultimaker/CuraEngine/tree/5.13.0
https://codeload.github.com/Ultimaker/CuraEngine/tar.gz/refs/tags/5.13.0

El archivo de fuentes conserva las instrucciones y recetas Conan/CMake de UltiMaker. Sus requisitos y referencias se encuentran en `conanfile.py`; la reconstrucción del motor requiere las herramientas y dependencias indicadas por ese proyecto. La compilación normal de 3D-Woods ya no requiere este motor ni lo ejecuta; se conserva como referencia técnica de versiones anteriores.

También se adjuntan fuentes upstream de libArcus y oneTBB. La revisión consultada de Arcus se registra en `libArcus-source.json`; la distribución oficial no identifica su commit binario. Los binarios de este paquete se conservan exactamente como UltiMaker los distribuye.

Referencias de las dependencias:

- Cura y definiciones: https://github.com/Ultimaker/Cura/tree/5.13.0
- libArcus: https://github.com/Ultimaker/libArcus
- oneTBB 2022.2.0: https://github.com/oneapi-src/oneTBB/tree/v2022.2.0
- Boost 1.88.0: https://github.com/boostorg/boost/tree/boost-1.88.0
- Clipper 6.4.2: https://www.angusj.com/delphi/clipper.php
- fmt 11.1.3: https://github.com/fmtlib/fmt/tree/11.1.3
- spdlog 1.15.1: https://github.com/gabime/spdlog/tree/v1.15.1
- range-v3 0.12.0: https://github.com/ericniebler/range-v3/tree/0.12.0
- RapidJSON: https://github.com/Tencent/rapidjson
- libpng 1.6.48: https://github.com/pnggroup/libpng/tree/v1.6.48
- protobuf: https://github.com/protocolbuffers/protobuf
- Sentry native: https://github.com/getsentry/sentry-native

Las licencias completas recopiladas están en esta carpeta. Se desactiva Sentry en el proceso del motor con `USE_SENTRY=0`. La app no descarga motores ni dependencias durante su uso.

Para regenerar el paquete desde una instalación oficial ya extraída, ejecuta con Python y objdump disponible:

```
python tools/build_engine_runtime.py RUTA_A_CURA_EXTRAIDO
```

El script recorre las importaciones PE para incorporar las DLL oficiales necesarias, agrega las definiciones y licencias y regenera los hashes. La compilación normal de 3D-Woods ya no incrusta este paquete en el ejecutable.
