# 3D-Woods · 0.8.2

Aplicación local para **Windows x64**: archivos en cajas 3D, costos, inventario físico y punto de venta. Abre su propia ventana. No incluye un laminador: se conecta a Cura, PrusaSlicer, OrcaSlicer, Bambu Studio, Simplify3D o cualquier programa que produzca G-code. No necesita cuenta. Trabaja sin conexión; solo las actualizaciones opcionales consultan GitHub. Publicada por **Plumas y Astas Studio**.

## Empezar

1. Extrae el ZIP y abre **3D-Woods.exe**.
2. En **Ajustes → Carpeta de la estantería**, elige dónde guardar tus proyectos. Por defecto usa `Documentos/3D-Woods`.
3. En **Ajustes → Impresoras**, configura tu máquina y sus costos. Se incluye un perfil inicial editable de Creality Ender 3 V3 SE con cama nominal de 220 × 220 × 250 mm; la potencia media y los demás costos son ejemplos para sustituir por tus valores.
4. En **Inventario**, registra lo que tienes: filamentos, insumos, productos terminados y equipo. Revisa las existencias iniciales de demostración antes de utilizarlas en ventas.
5. Arrastra modelos a la estantería o a una caja. Lleva el modelo al **Puente de impresión**, lamina en tu programa y guarda el G-code en la carpeta vigilada para leer tiempo, filamento y medidas.
6. En **Ajustes · Actualizaciones** puedes revisar la versión, activar o desactivar la descarga automática y cambiar el repositorio de GitHub. Las actualizaciones se verifican con SHA-256 y se instalan al reiniciar.

La ventana necesita **Microsoft Edge WebView2 Runtime**, habitualmente presente en Windows 10/11. Si falta, la app lo indicará. Instalador oficial: https://developer.microsoft.com/microsoft-edge/webview2/#download-section. Después de instalarlo puedes trabajar sin conexión. Para usar el ejecutable no necesitas Python, Node.js, Go ni el navegador abierto. Para preparar el G-code sí necesitas tu propio laminador externo; 3D-Woods no lo instala.

## Cajas sobre estantes

Cada estante tiene **cinco espacios**. Al agregar una sexta caja aparece otro estante, y así sucesivamente. Los estantes se dibujan como un solo mueble continuo tallado en madera: los postes parecen troncos con anillos de corte y nudos, las tablas parecen ramas y cada tabla lleva hojas talladas. Las cajas conservan sus seis caras, perspectiva, portada y animación. Pulsa una caja para tomarla: se acerca y después aparece su ficha. **Abrir esta caja** confirma la selección; **Devolver** o Esc anima el regreso de la caja a su lugar. Anterior/Siguiente, también dentro de la ficha, devuelven la caja actual y acercan la siguiente. Las flechas recorren las cajas. Hay una vista de lista y se respeta la preferencia del sistema de reducir movimiento.

Pulsa **Ordenar cajas** para arrastrarlas entre espacios, incluso entre estantes. Soltar sobre una caja intercambia sus lugares; soltar sobre un hueco lo ocupa. **Mover** permite elegir estante y lugar sin arrastrar. El orden y los huecos quedan guardados, también en respaldos. Las nuevas cajas ocupan el primer hueco libre. El selector **Mi orden guardado** recupera esta distribución después de ordenar por nombre o fecha.

Las categorías de la estantería son personalizables. En **Ajustes → Categorías de cajas** puedes crear, renombrar o eliminar categorías, y ver cuántas cajas tiene cada una. Al crear una caja eliges su categoría, que también se puede cambiar en la ficha del objeto. **Sin categoría** es la base protegida; al eliminar otra categoría, sus cajas pasan a **Sin categoría** sin borrar archivos. **Todo**, **Armables** y **Favoritos** son filtros inteligentes y no se pueden usar como nombres de categoría.

Cambiar de objeto dentro de una caja, en la calculadora o en el puente de impresión anima la entrada de su vista y la cámara 3D. Arrastrar la vista interrumpe la animación de cámara para darte el control.

Cada subcarpeta directa de la carpeta principal representa una caja. Puede contener varios objetos y todos sus componentes. Los archivos anidados también se detectan. La app revisa carpetas nuevas y archivos aproximadamente cada dos minutos; **Actualizar** fuerza la revisión. Arrastrar archivos los copia y conserva los originales; los nombres repetidos reciben un sufijo.

Los datos de cada caja quedan en `.3dwoods.json` dentro de su carpeta y el catálogo en `.3dwoods-library.json`. Conserva esos archivos al mover proyectos. La ubicación del taller queda en `%APPDATA%/3D-Woods/settings.json`.

**Eliminar caja** mueve su carpeta completa a `.3dwoods-papelera`, dentro del taller. Puedes abrirla desde Ajustes y devolver una carpeta al primer nivel para recuperarla. El historial de ventas conserva sus nombres e importes.

## Modelos y datos editables

- Visor: STL binario/ASCII, OBJ, 3MF y GLB con recursos incrustados, sin Draco/KTX. STL y OBJ permiten elegir mm, cm o pulgadas; 3MF conserva su unidad y GLB se convierte desde metros.
- Referencias: PNG, JPG, WEBP, SVG, PDF, TXT, MTL y G-code. Los MTL externos de OBJ no se interpretan en esta edición.
- Cada objeto admite varias piezas, cantidades por componente, escalas, filamentos, insumos, acabado y notas. “2D” significa relieve impreso en FDM, como un llavero de una cara.
- Las medidas aparecen en centímetros. Puedes mover y girar componentes para representar el objeto armado y guardar esa vista como portada. Los originales se conservan. Las rotaciones de impresión se editan por separado en tu laminador externo.
- Puedes editar nombres, precios, tiempos, gramos, materiales, existencias y perfiles. Cambiar escala, cantidad o material invalida las estimaciones anteriores cuando corresponde.
- Los ejemplos son ilustrativos y no están certificados para imprimir. No se reparan automáticamente las mallas. No hay límite de peso para agregar archivos a la estantería. El visor 3D admite hasta nueve millones de vértices por modelo.
- La estantería muestra la portada guardada de cada caja y no abre las mallas de los objetos cerrados. Solo la caja y el objeto que estás viendo cargan su modelo. Las portadas nuevas se generan de una en una, en segundo plano, y las antiguas se compactan para que el catálogo siga ligero.

## Puente de impresión

3D-Woods no lamina. Prepara el modelo, abre tu laminador y lee el G-code que produzca, sin depender de un motor propio.

1. En **Ajustes → Puente de impresión** o en la página **Puente de impresión**, elige el programa y, si hace falta, su ejecutable. Si dejas la ruta vacía se intenta detectar Cura, PrusaSlicer, OrcaSlicer, Bambu Studio o Simplify3D.
2. Elige la **carpeta que observa el puente**. Puedes usar la carpeta de salida de tu laminador; también puedes arrastrar el G-code sobre la ventana o abrirlo con **Abrir G-code**.
3. Desde una caja o el puente pulsa **Abrir laminador externo** o **Enviar STL al laminador**. Lamina allí con tu perfil, soportes y orientación habituales y guarda el resultado en la carpeta vigilada.
4. El puente reconoce G-code de Cura, PrusaSlicer, OrcaSlicer, Bambu Studio y Simplify3D: lee tiempo, filamento, colores declarados, capas y miniatura incrustada. Si el archivo no incluye miniatura, toma una imagen del visor 3D. Las medidas se obtienen de la cabecera del laminador o, si faltan, de los recorridos del G-code.
5. Revisa o corrige **gramos, color, material, unidades, minutos y medidas**. Algunos laminadores no declaran color ni material; en ese caso selecciónalos a mano. **Guardar en el objeto** aplica los datos a la calculadora sin descontar inventario.
6. Pulsa **Iniciar seguimiento** para descontar el filamento según el avance (tiempo estimado o confirmación manual) o **Enviar por USB** para usar el progreso real de los comandos confirmados. Al completar puedes sumar las piezas terminadas al stock.

El puente procesa un G-code por vez y puede copiar el archivo a la caja con **Copiar G-code a la caja**. No modifica el G-code ni inserta pausas de color: los cambios de filamento se preparan en tu laminador (M600, M0 o herramienta compatible). La vista de capas y el editor de recorridos de versiones anteriores ya no forman parte de esta edición.

Límites: el envío USB admite G-code de hasta 25 MB; la miniatura y los metadatos dependen de lo que escriba cada laminador. La carpeta vigilada requiere la aplicación de Windows; en el navegador se usan arrastrar y soltar o **Abrir G-code**.

## Impresión USB y consumo de inventario

En **Puente de impresión → Enviar por USB**:

1. Carga el G-code desde la carpeta vigilada, arrástralo o ábrelo con **Abrir G-code**.
2. Selecciona el perfil de impresora, pulsa **Actualizar puertos** y elige el COM y los baudios.
3. **Probar conexión** abre el puerto y consulta la identificación M115, sin movimientos ni calentamiento. La placa puede reiniciarse al abrir USB. Cierra otros programas que usen ese puerto.
4. Si no aparece el dispositivo, elige **Puerto COM manual** e introduce el COM que muestra el Administrador de dispositivos. El modo manual no inventa un puerto: abrirlo y recibir la identificación del firmware sigue siendo necesario.
5. Pulsa **Revisar e imprimir** y confirma el envío. El diálogo permite indicar unidades y si al completar se suman piezas al stock; el puerto se configura en el panel USB. La sesión descuenta filamento a medida que el firmware confirma comandos.

El envío usa protocolo Marlin compatible: una línea a la vez, número, checksum y respuesta `ok`. Solo se reenvía la línea actual cuando el firmware lo solicita. Un reinicio, error o desconexión detiene el envío sin reanudarlo automáticamente. **Pausar envío** espera la confirmación del comando actual. **Detener · M112** solicita una parada; verifica la impresora y reiníciala si corresponde.

La app bloquea su cierre normal durante una impresión y solicita a Windows evitar la suspensión. El porcentaje indica comandos confirmados, no tiempo restante. Apagar el PC, forzar el cierre o desconectar USB interrumpe el proceso. Al detener, el puente conserva el consumo ya confirmado; puedes anular la sesión desde el historial para devolver filamento y piezas.

Los cambios de color se preparan en tu laminador (M600, M0 o herramienta compatible) y viajan dentro del G-code. 3D-Woods ya no edita pausas ni inserta macros. Una Ender de un solo filamento necesita cambios manuales o componentes separados; M600 no se presupone habilitado en su firmware.

La detección combina los puertos serie nativos de Windows con sus datos PnP, y conserva la compatibilidad con dispositivos asociados en versiones anteriores. La conexión consulta firmware antes de enviar el G-code y permite reintentar la identificación si la placa se reinicia durante el arranque.

Los errores permanecen en un panel, aunque se vuelva a consultar el estado. **Diagnóstico USB** muestra el intercambio y permite guardarlo en TXT. Si sigue fallando en tu equipo, ese archivo permite distinguir puerto ocupado, controlador, velocidad, falta de respuesta y rechazo de un comando.

No se implementa envío por API de red ni protocolos propietarios.

## Impresoras e inventario físico

**Ajustes → Impresoras** admite varios perfiles independientes, cada uno con cama, potencia, costo de compra, vida útil, repuestos y conexión. Puedes asociar un dispositivo USB o indicar IP/nombre y puerto de red. La detección se actualiza aproximadamente cada cinco segundos sin escanear toda la red ni abrir el puerto COM para identificarla. La presencia de USB o un puerto de red abierto indica conectividad; no identifica por sí sola el modelo ni certifica que esté lista.

**Inventario** reúne:

- **Productos terminados**: piezas físicas, SKU, cantidad, mínimo, costo y precio de venta. Puedes asociarlas a un objeto de una caja.
- **Filamentos**: uno o varios colores por bobina (por ejemplo, degradados o cambio de color), precio/peso, densidad, gramos disponibles y mínimo. El primer color es el principal y el punto de venta permite elegir cualquiera de ellos al cobrar. En el inventario, una bobina con varios colores se muestra como un solo carrete dividido en sus colores.
- **Insumos**: argollas, imanes, pegamento, pintura, empaques, etc., en piezas, gramos, ml o metros. Ejemplo: botella de 250 ml, consumo de 2 ml por objeto.
- **Equipo y otros**: perfiles de impresora y artículos físicos del taller.
- **Movimientos**: compras, producción, impresiones y ajustes de conteo.

**Registrar compra** suma paquetes o bobinas completos y descuenta del saldo el importe total pagado, que puedes incluir con envío/descuentos. Revisa ese importe al cambiar la cantidad de paquetes. Los costos para presupuestar se editan en cada artículo.

**Registrar producción**, sobre un producto vinculado, registra piezas ya fabricadas: consume su filamento e insumos y agrega productos terminados. Actualiza su costo medio con el costo estimado de esa producción. Editar existencias registra un ajuste de conteo y no inventa un gasto o una compra.

Puedes eliminar artículos y cambiar materiales de objetos. Cuando hay historial se retiran y pueden restaurarse. Para un filamento o insumo utilizado elige un reemplazo o deja su asignación pendiente. No se transfieren existencias entre artículos al reemplazarlos.

## Punto de venta

La pantalla tiene catálogo con búsqueda por nombre/SKU, carrito, cantidades, precio editable, cliente/referencia, total, cobro, importe recibido y cambio. Las tarjetas del catálogo y el ticket previo al cobro usan un formato compacto: la miniatura y el logo del comprobante no ocupan el espacio de trabajo. Registra efectivo, transferencia o tarjeta como control local; no procesa pagos bancarios. F2 abre una nueva venta y F4 lleva al cobro.

Cada línea permite elegir el color solicitado. En productos terminados es una preferencia para el pedido; al fabricar bajo pedido se descuenta el filamento del color elegido en cada material del objeto, incluso si la bobina tiene varios colores. El total y el costo se recalculan al cambiar la selección.

Los tickets sin cobrar se guardan como borradores con un número estable (`W-000001`, etc.) y sobreviven a la navegación o al cierre de la app. Vuelve a **Punto de venta** para recuperar el más reciente, abre otro desde la barra de tickets abiertos o crea una venta nueva. Un borrador no descuenta stock hasta confirmar el cobro.

En la pestaña **Tickets** consulta cada venta, imprime el comprobante o genera un **ticket virtual** en HTML o texto. **Devolución** permite elegir piezas de una venta y registrar un reembolso parcial o total: el stock regresa, el dinero se descuenta de la caja y la venta original se conserva. Puedes hacer varias devoluciones parciales y anular una devolución concreta; para anular la venta completa primero deben anularse sus devoluciones vigentes.

En **Cortes** genera un **corte parcial** informativo o un **corte total**. El parcial muestra ventas, precios, horas, devoluciones, compras, formas de pago y utilidad sin reiniciar nada. El total guarda el mismo detalle y comienza un periodo nuevo, pero no borra ventas ni movimientos. Ambos se pueden imprimir o descargar como documento virtual con el jackalope, el nombre, lema, teléfono, correo, dirección y pie de tu negocio, configurables en **Ajustes → Marca de tickets y cortes**.

- **Productos en inventario**: cobra y descuenta únicamente las piezas terminadas. No vuelve a descontar los materiales que consumiste al producirlas.
- **Fabricar bajo pedido**: cobra el pedido y descuenta los materiales previstos del modelo, con reserva de filamento opcional. Este flujo registra el consumo al vender; evita registrar después la misma fabricación como producción.

Si falta stock o información de costo, se rechaza el ticket completo. Cotizar no descuenta existencias; la impresión en seguimiento sí las consume de forma proporcional al avance.

| Resultado | Cálculo |
| --- | --- |
| Ventas netas | Ventas vigentes menos devoluciones vigentes |
| Compras y reposiciones | Compras vigentes |
| Saldo del taller | Ventas netas menos compras registradas |
| Utilidad estimada | Ventas netas menos costos capturados al vender, ajustados por devoluciones |

Los resultados se separan por moneda. El saldo no incluye automáticamente todos los gastos e impuestos. El costo de los materiales ya forma parte de la utilidad estimada; las compras no se restan otra vez de ese indicador. Cambiar moneda solo cambia la etiqueta, sin convertir importes.

Los mínimos de stock generan avisos por artículo. **Anular** conserva el registro y revierte cantidades e importes. No puedes anular una compra cuyo stock ya se consumió; para anular producción debes deshacer primero movimientos posteriores de ese producto.

## Calculadora por objeto

`fabricación = filamento + electricidad + desgaste + reserva de repuestos`

`costo unitario = fabricación × (1 + error / 100) + insumos + acabado + cargo único / unidades`

`precio unitario = costo unitario × multiplicador`

La electricidad usa W medios, horas y precio de kWh. Desgaste = compra de máquina / vida útil × horas. Repuestos = costo / intervalo de mantenimiento × horas. El margen de error es un recargo de costo. Los insumos se vinculan al inventario compartido y se reparten por unidades consumidas.

| Multiplicador | Uso |
| --- | --- |
| ×2.0 | Alto volumen / descuento |
| ×2.5 | Volumen medio |
| ×3.0 | Mayorista |
| ×3.5 | Intermedio |
| ×4.0 | Minorista |
| ×5.0 | Llaveros / piezas chicas |

Admite multiplicador personalizado y pieza grande, chica o única. Los precios no incluyen impuestos. Las cotizaciones guardadas conservan una captura de sus parámetros y pueden exportarse en CSV.

La calculadora muestra material por color, bobinas equivalentes y bobinas adicionales según stock y reserva. La distribución por cama muestra piezas numeradas, espacios libres, margen, ejes y número de cama. Es una cuadrícula estimada por componente; revisa soportes, brim y orientación en tu laminador externo.

## Actualizaciones desde GitHub

3D-Woods puede actualizarse sin descargar el ZIP a mano. Al abrir la aplicación consulta la última versión publicada en GitHub, la descarga y verifica su firma **SHA-256** antes de ofrecer el reinicio. También revisa cada seis horas mientras la app está abierta. Puedes desactivar la búsqueda automática o cambiarla por otro repositorio en **Ajustes · Actualizaciones**.

- La actualización se instala al reiniciar: la app guarda lo pendiente, cierra su ventana, reemplaza **solo el ejecutable** y vuelve a abrirse.
- Tus cajas, archivos, inventario, ventas y ajustes viven fuera del ejecutable y no se modifican.
- Si el SHA-256 no coincide con el publicado, la actualización se descarta y no se instala.
- Mientras haya una impresión USB activa no se permite actualizar.
- La descarga solo acepta direcciones HTTPS de GitHub. Si no hay internet o el repositorio no tiene versiones publicadas, la app sigue funcionando con normalidad.

Los perfiles de Windows muestran **Plumas y Astas Studio** como editor, **3D-Woods** como producto y la versión instalada. Para que Windows y los antivirus reconozcan la firma como verificada hace falta un certificado Authenticode emitido a nombre del estudio. La app ya incluye los metadatos y el flujo de firma; consulta `FIRMA.md` para configurarlo. Un certificado autofirmado no evita los avisos de SmartScreen.

El repositorio predeterminado es `plumasyastas/3d-woods`. Si publicas en otra cuenta, escribe `usuario/repositorio` en **Ajustes · Actualizaciones**. El repositorio debe ser público y cada versión debe incluir `3D-Woods.exe` y `SHA256SUMS.txt`; el flujo de `.github/workflows/release.yml` los genera al publicar una etiqueta `v0.8.2`.

### Publicar una versión

1. Sube el contenido de `3D-Woods` al repositorio de GitHub.
2. En **Settings → Secrets and variables → Actions** agrega `WINDOWS_PFX_BASE64` y `WINDOWS_PFX_PASSWORD` solo si ya tienes un certificado Authenticode del estudio. Sin ellos, la versión se publica sin firma de certificado, pero conserva los metadatos de Plumas y Astas Studio y la verificación SHA-256.
3. Crea y sube una etiqueta con el número de versión: `git tag v0.8.2` y `git push origin v0.8.2`.
4. El flujo **Publicar 3D-Woods** ejecuta las pruebas, compila en Windows, firma si hay certificado, genera `SHA256SUMS.txt` y crea la versión de GitHub.
5. La app instalada detecta esa versión en su próxima revisión y ofrece reiniciar para instalarla.

Los detalles de la firma, sus límites y cómo comprobar el editor se explican en `FIRMA.md`.

Para actualizar desde 0.4, 0.5, 0.6 o 0.7 también puedes cerrar esa versión, extraer este ZIP y abrir el ejecutable nuevo. La ubicación del taller se conserva. El puente de impresión conserva la carpeta vigilada y la ruta del laminador; revísalas en Ajustes si cambias de equipo. No borres la carpeta de tus proyectos.

## Verificación y código

Versión **0.8.2**, compilada para Windows x64. La revisión visual de esta versión se realizó con Chromium en Windows. Las pruebas automatizadas cubren costos, formatos, estantes de cinco espacios, selección con ficha oculta, importación, guardado, inventario, producción, cobro, anulaciones, lectura de G-code de varios laminadores, sesiones de impresión, consumo proporcional, protocolo USB simulado, tickets abiertos con numeración estable, devoluciones parciales, cortes de caja, filamentos multicolor, comprobantes con la marca del negocio, categorías personalizables, el estante continuo tallado como árbol, el carrete dividido en varios colores y la actualización verificada por SHA-256.

Los G-code de prueba se generan con cabeceras y miniaturas representativas de Cura, PrusaSlicer, OrcaSlicer, Bambu Studio y Simplify3D; no se ejecuta un laminador externo durante las pruebas. La ventana nativa de Windows, la instalación de una actualización real y una impresión física por USB no se han probado en este entorno. El envío USB se verificó con un dispositivo simulado.

`codigo` contiene las fuentes, dependencias de producción locales, pruebas y licencias. Los archivos de CuraEngine en `codigo/engine` y `codigo/third_party` se conservan solo como referencia técnica y no forman parte del ejecutable. Para compilar se necesita Go 1.25+; Node.js se usa para las pruebas de interfaz.

```powershell
npm ci
npm run check
go test ./...
./tools/versioninfo.ps1 -Version 0.8.2
go build -mod=vendor -buildvcs=false -trimpath -ldflags "-s -w -H=windowsgui -X main.appVersion=0.8.2" -o 3D-Woods.exe .
```

El flujo de GitHub actualiza `dist/core.js`, `versioninfo.json` y la versión de Go a partir de la etiqueta antes de compilar. Para una compilación local, cambia `APP_VERSION` en `codigo/dist/core.js`, ejecuta `tools/versioninfo.ps1 -Version 0.8.2` y usa el mismo número en `-X main.appVersion=0.8.2`.

La ventana usa WebView2 incrustado y un servicio interno autenticado que escucha solo en `127.0.0.1`, con rutas limitadas al taller. No se publica ni requiere hosting. No se implementan telemetría ni servicios en la nube; las actualizaciones consultan la API pública de GitHub solo cuando corresponde. Licencias y procedencia: `THIRD_PARTY_NOTICES.md` y `codigo/third_party/CuraEngine`.
