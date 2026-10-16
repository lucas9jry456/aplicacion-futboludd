# Configuración de Google Sheets para el Formulario de Evaluación

Sigue estos sencillos pasos para que todas las evaluaciones de la aplicación se guarden automáticamente en tu propia hoja de cálculo de Google Drive.

---

## Paso 1: Crear la Hoja de Cálculo
1. Entra a [sheets.new](https://sheets.new) en tu navegador.
2. Nombra tu hoja como: **Evaluaciones Futbol AI Tracker**.
3. En la primera fila (Fila 1), coloca los siguientes encabezados de columna:

| A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|
| **Fecha** | **Nombre** | **Rol** | **Fluidez (1-5)** | **Precisión IA (1-5)** | **Highlights (1-5)** | **Usabilidad (1-5)** | **Comentarios** |

---

## Paso 2: Abrir Google Apps Script
1. En la hoja de cálculo, haz clic en el menú superior: **Extensiones > Apps Script**.
2. Borra todo el código que aparezca en el editor (`function myFunction() { ... }`).
3. Pega el siguiente código exactamente como está:

```javascript
function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = JSON.parse(e.postData.contents);
    
    // Insertar fila con las respuestas
    sheet.appendRow([
      data.fecha || new Date().toLocaleString(),
      data.nombre || 'Anónimo',
      data.rol || 'No especificado',
      data.fluidezVideo || '',
      data.precisionIA || '',
      data.mejoresMomentos || '',
      data.experienciaMovilPC || '',
      data.comentarios || ''
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

---

## Paso 3: Implementar como Aplicación Web (Webhook)
1. En la parte superior derecha de Apps Script, haz clic en el botón azul **Implementar** (Deploy) y selecciona **Nueva implementación** (New deployment).
2. En el icono de engranaje (⚙) a la izquierda, selecciona **Aplicación web**.
3. Configura:
   - **Descripción**: `Webhook Evaluaciones`
   - **Ejecutar como**: `Yo (tu correo)`
   - **Quién tiene acceso**: **`Cualquier usuario (Anyone)`** *(Muy importante para permitir el envío desde la app)*
4. Haz clic en **Implementar**.
5. Si Google te pide autorizar permisos, haz clic en **Revisar permisos**, selecciona tu cuenta, pulsa en **Configuración avanzada** y luego en **Ir a Webhook (no seguro)** y finalmente **Permitir**.
6. Copia la **URL de la aplicación web** (termina en `/exec`).

---

## Paso 4: Pegar la URL en la Aplicación
1. Abre la aplicación de fútbol.
2. Ve a la pestaña **Formulario de Evaluación** o presiona el botón ⚙ en la esquina superior.
3. Pega la URL en el campo y haz clic en **Guardar Webhook**.
4. ¡Listo! A partir de ese momento, cada evaluación que envíes se guardará en tiempo real en tu Google Sheet.
