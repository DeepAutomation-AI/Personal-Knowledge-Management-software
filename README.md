# Atlas · Gestión del conocimiento personal

Atlas es una aplicación de PKM en español para escribir, organizar y conectar notas. Funciona en un navegador moderno y guarda la bóveda en IndexedDB, dentro del dispositivo. La interfaz se adapta a escritorio y móvil, con temas claro y oscuro y una versión PWA.

Esta versión implementa un flujo de trabajo útil inspirado en las notas Markdown conectadas. Su alcance y las funciones pendientes están descritos en [la matriz de calidad](docs/QUALITY.md); no ofrece todavía paridad completa con Obsidian ni una certificación de calidad.

## Empezar

Requisitos: **Node.js 24** —fijado en `.nvmrc`— y npm. No se necesitan cuentas, claves de API, base de datos externa ni servicios adicionales.

```bash
npm ci --cache /workspace/.cache/atlas-npm
npm run dev
```

El primer comando utiliza una caché escribible en el entorno de nube. Fuera de ese entorno, puedes usar `npm ci` con la caché habitual de npm. Abre la dirección de desarrollo que muestra Vite. Esa dirección corresponde al servidor de desarrollo de tu máquina o entorno; no es un despliegue público.

La primera visita crea diez notas de ejemplo. Las siguientes visitas recuperan la bóveda existente, incluso si está vacía. Una bóveda dañada produce un error y se conserva para evitar reemplazar tus datos por los ejemplos.

## Qué puedes hacer

- Crear, editar, renombrar, duplicar y mover notas entre carpetas; marcar favoritas y restaurar notas desde la papelera.
- Escribir Markdown y leer encabezados, tablas, listas, citas, bloques de código y tareas GFM. Los modos **Escribir**, **Leer** y **Dividir** permiten editar y revisar el resultado.
- Conectar notas con `[[Título]]`, `[[Título|texto visible]]` o `[[Carpeta/Título.md]]`. Los alias y encabezados se conservan al renombrar enlaces; el panel muestra enlaces entrantes y salientes.
- Organizar con `#etiquetas`, buscar sin distinguir mayúsculas ni tildes y combinar filtros. Por ejemplo: `tag:hábitos folder:Personal is:favorite`, `"ideas para" -folder:Recursos` o `is:trash`.
- Explorar un grafo de conexiones reales, filtrar sus notas, acercar, alejar y abrir una nota desde un nodo.
- Crear la nota del día, usar plantillas y reunir las tareas de las notas en una vista con pendientes y completadas.
- Guardar automáticamente, crear hasta diez instantáneas locales y transferir notas mediante Markdown, ZIP o una copia JSON.

Los títulos deben ser cortos y compatibles con nombres de archivo y wikilinks: máximo 240 bytes UTF-8, sin delimitadores `[]#`, separadores de ruta ni caracteres reservados del sistema. Las carpetas admiten rutas relativas anidadas y rechazan recorridos como `../`.

Atajos disponibles: **Ctrl / ⌘ + K** para buscar, **Ctrl / ⌘ + N** para crear una nota y **Ctrl / ⌘ + S** para guardar. Las preferencias de tema y las carpetas vacías se guardan en `localStorage`; el contenido de las notas y las instantáneas se guarda en IndexedDB.

## Guardado y copias

Usa una sola pestaña para editar la bóveda. Espera el estado **Guardado** antes de cerrar la aplicación. Los errores de almacenamiento se muestran en la interfaz; disponer de una instantánea local no protege frente a borrar los datos del navegador.

En **Ajustes** puedes:

| Formato          | Contenido y comportamiento                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JSON             | Copia versionada de todas las notas, incluidos IDs, fechas, carpetas, favoritas y papelera. Importarla reemplaza la bóveda tras confirmar y guardar una instantánea previa. |
| ZIP Markdown     | Exporta las notas activas en archivos `.md` con sus carpetas y un `atlas-manifest.json` con metadatos. Permite reutilizar el contenido en otras herramientas.               |
| Markdown / texto | Importa archivos UTF-8 `.md`, `.markdown` y `.txt`; se añaden como nuevas notas.                                                                                            |
| Instantánea      | Conserva una versión de la bóveda en el mismo navegador. Se mantienen las diez más recientes. La restauración preserva una copia del estado anterior.                       |

Las copias JSON no incluyen el tema, las carpetas sin notas ni las instantáneas. La reimportación de un ZIP genera nuevos IDs y conserva los metadatos que proporciona su manifiesto; un ZIP externo solo aporta los archivos de texto y sus rutas. Los adjuntos no se importan. La interfaz asigna títulos únicos cuando se añaden notas con nombres repetidos y adapta los enlaces internos del lote importado.

Los límites de importación de archivos son **5 MiB por archivo de texto**, **20 MiB en conjunto después de descomprimir** y **500 archivos por operación**. La importación JSON admite hasta **20 MiB** y **20 000 notas**. Estos límites protegen la importación; no representan resultados de rendimiento para bóvedas de ese tamaño.

La bóveda pertenece al origen web y al perfil del navegador que la creó. Cambiar de dominio, puerto, navegador o dispositivo requiere exportar e importar. Una ventana privada puede eliminar sus datos al cerrarse. Guarda copias externas periódicas y antes de borrar datos del navegador.

## Producción y uso sin conexión

```bash
npm run build
npm run preview
```

`dist/` contiene la aplicación estática. Sirve ese directorio en la raíz `/` de un sitio HTTPS; el manifiesto y el service worker usan rutas absolutas desde esa raíz. Para las comprobaciones locales, los navegadores permiten service workers en una dirección de loopback.

La PWA conserva la interfaz de producción y las notas del navegador para trabajar sin red una vez cargados y almacenados sus recursos. Para comprobarlo, abre la versión de producción con conexión, espera a que se active el service worker, recarga una vez con conexión y después vuelve a abrirla sin red. La instalación como aplicación depende del navegador. Las imágenes remotas y los enlaces externos pueden requerir conexión.

`npm run dev` no registra el service worker. Las comprobaciones de funcionamiento sin conexión se realizan contra la compilación de producción.

## Validación

Ejecuta las comprobaciones en este orden:

```bash
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

Vitest comprueba el modelo de bóveda, la búsqueda, los enlaces, el Markdown seguro, las importaciones y las transacciones de IndexedDB con `fake-indexeddb`. Playwright inicia la versión de producción y comprueba los flujos principales en vistas de escritorio y móvil con Chromium, incluida la recarga sin red.

En el entorno de nube puede reutilizarse Chromium del sistema mediante `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`. Fuera del entorno y en CI se utiliza el navegador instalado por Playwright. La automatización se define en [`.github/workflows/ci.yml`](.github/workflows/ci.yml). Las trazas de una prueba fallida quedan en `test-results/`.

## Privacidad y límites actuales

No hay autenticación, sincronización entre dispositivos ni cifrado de las notas almacenadas o exportadas. La aplicación no envía las notas a un backend ni incorpora analítica; abrir enlaces externos o mostrar imágenes remotas sí puede hacer solicitudes a esos sitios. Protege el dispositivo y trata las copias exportadas como archivos que pueden contener información sensible.

El renderizado omite HTML crudo y filtra protocolos de enlaces e imágenes. La importación valida tipos, fechas, IDs, rutas, UTF-8 y tamaños. Estas medidas tienen pruebas automatizadas, pero no sustituyen una auditoría independiente de seguridad.

La experiencia web adaptable y la PWA constituyen el soporte multiplataforma actual. No se han validado todavía aplicaciones nativas, otros motores de navegador ni dispositivos físicos. Canvas, plugins de Obsidian, adjuntos y embeds de bóveda, propiedades YAML, múltiples bóvedas y sincronización cifrada siguen pendientes. Consulta [QUALITY.md](docs/QUALITY.md) para ver la evidencia y los criterios de ampliación.

## Código

| Ruta                    | Responsabilidad                                               |
| ----------------------- | ------------------------------------------------------------- |
| `src/App.tsx`           | Biblioteca, editor, navegación, tareas, plantillas y ajustes. |
| `src/components/`       | Markdown, grafo y diálogos.                                   |
| `src/lib/vault.ts`      | Modelo de datos, validación, búsqueda, enlaces y tareas.      |
| `src/lib/storage.ts`    | Guardado y restauración transaccional en IndexedDB.           |
| `src/lib/files.ts`      | Intercambio de Markdown y ZIP con límites de importación.     |
| `src/hooks/useVault.ts` | Carga y cola de autoguardado.                                 |
| `public/`               | Manifiesto, icono y service worker de la PWA.                 |
| `e2e/`                  | Pruebas de los flujos de usuario en producción.               |

Cada tarea de nube ya usa un entorno aislado. Trabaja sobre el checkout existente; no hace falta crear un worktree para desarrollar o validar Atlas.
