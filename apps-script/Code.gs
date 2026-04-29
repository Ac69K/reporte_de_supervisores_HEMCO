/**
 * Apps Script — HEMCO Reporte de Turno
 * BUG FIX #3: Persistencia bidireccional (guardar + cargar estado completo)
 * 
 * INSTRUCCIONES:
 * 1. Abre tu Google Sheet → Extensiones → Apps Script
 * 2. Reemplaza TODO el código con este archivo
 * 3. Deploy → New deployment → Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copia la URL del deployment y actualiza SHEETS_URL en main.js
 */

function doPost(e) {
  try {
    var jsonString = e.parameter.data;
    var datos = JSON.parse(jsonString);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    var fecha = datos.fecha || new Date().toISOString().slice(0,10);
    var turno = datos.turno || datos.userShift || 'N/A';
    var supervisor = datos.supervisor || datos.userName || 'N/A';
    var rol = datos.rol || datos.userRole || 'N/A';
    var valores = datos.V || datos.valores || {};
    var ts = datos.ts || Date.now();
    
    // ═══ HOJA "Estado" — estado completo para recuperación remota ═══
    var sheetEstado = getOrCreateSheet(ss, 'Estado', ['Fecha','Turno','Supervisor','Rol','Estado_JSON','Timestamp']);
    
    // Buscar fila existente para esta fecha+turno (actualizar en vez de duplicar)
    var dataEstado = sheetEstado.getDataRange().getValues();
    var filaExistente = -1;
    for (var i = 1; i < dataEstado.length; i++) {
      if (dataEstado[i][0] === fecha && dataEstado[i][1] === turno) {
        filaExistente = i + 1; // 1-indexed
        break;
      }
    }
    
    var estadoJSON = JSON.stringify(datos);
    
    if (filaExistente > 0) {
      // Actualizar fila existente
      sheetEstado.getRange(filaExistente, 1, 1, 6).setValues([
        [fecha, turno, supervisor, rol, estadoJSON, new Date(ts)]
      ]);
    } else {
      // Insertar nueva fila
      sheetEstado.appendRow([fecha, turno, supervisor, rol, estadoJSON, new Date(ts)]);
    }
    
    // ═══ HOJAS DE SECCIÓN — distribución de datos por área ═══
    
    // Hoja Reportes (general)
    var headersReportes = ['Fecha','Turno','Supervisor','Rol','Timestamp'];
    var rowReportes = [fecha, turno, supervisor, rol, new Date(ts)];
    // Solo insertar si no existe ya
    var sheetReportes = getOrCreateSheet(ss, 'Reportes', headersReportes);
    var reporteExiste = buscarFila(sheetReportes, fecha, turno);
    if (reporteExiste < 0) {
      sheetReportes.appendRow(rowReportes);
    } else {
      sheetReportes.getRange(reporteExiste, 1, 1, headersReportes.length).setValues([rowReportes]);
    }
    
    // Hoja Trituración_Molienda — valores relevantes
    guardarSeccion(ss, 'Trituración_Molienda', fecha, turno, valores, [
      'gr_1b','gr_7','gr_13a','gr_13b',
      'mol_md1','mol_md2','mol_sep','mol_m1','mol_m2','mol_m4','mol_m5',
      'cg_sol','cg_pas','cg_cn','cg_ph',
      'pb_13a','pb_13'
    ]);
    
    // Hoja Agitadores_Espesadores
    guardarSeccion(ss, 'Agitadores_Espesadores', fecha, turno, valores, [
      'esp1a_sol','esp1b_sol','esp3b_sol','esp8_sol','esp9_sol',
      'ag0_sol','ag0_m200','ag0_cn','ag0_o2','ag0_ph',
      'ag6_sol','ag1_o2','ag2_o2'
    ]);
    
    // Hoja Precipitación
    guardarSeccion(ss, 'Precipitación', fecha, turno, valores, [
      's3_pregE','s3_pregC','s3_barC','s3_barE','s3_esp8','s3_esp9',
      's3_ton_min','s3_ton_max',
      's3_zinc','s3_cnlib','s3_cndos',
      's3_turb_in','s3_turb_out'
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({status:'success'}))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({status:'error',message:error.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * doGet — Retorna el estado guardado para una fecha+turno
 * Permite al supervisor cargar el reporte desde otro dispositivo
 */
function doGet(e) {
  try {
    var action = (e.parameter.action || '').toLowerCase();
    
    if (action === 'cargar') {
      var fecha = e.parameter.fecha;
      var turno = e.parameter.turno;
      
      if (!fecha || !turno) {
        return jsonResponse({status:'error',message:'Faltan parámetros fecha y turno'});
      }
      
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName('Estado');
      
      if (!sheet) {
        return jsonResponse({status:'not_found'});
      }
      
      var data = sheet.getDataRange().getValues();
      // Buscar la última coincidencia (más reciente)
      for (var i = data.length - 1; i >= 1; i--) {
        if (data[i][0] === fecha && data[i][1] === turno) {
          var estadoJSON = data[i][4]; // columna Estado_JSON
          try {
            var estado = JSON.parse(estadoJSON);
            return jsonResponse({status:'ok', estado:estado});
          } catch(parseErr) {
            return jsonResponse({status:'error',message:'Estado corrupto'});
          }
        }
      }
      
      return jsonResponse({status:'not_found'});
    }
    
    // Acción por defecto: listar turnos del día
    if (action === 'listar') {
      var fecha2 = e.parameter.fecha || new Date().toISOString().slice(0,10);
      var ss2 = SpreadsheetApp.getActiveSpreadsheet();
      var sheet2 = ss2.getSheetByName('Estado');
      if (!sheet2) return jsonResponse({status:'ok',turnos:[]});
      
      var data2 = sheet2.getDataRange().getValues();
      var turnos = [];
      for (var j = 1; j < data2.length; j++) {
        if (data2[j][0] === fecha2) {
          turnos.push({
            fecha: data2[j][0],
            turno: data2[j][1],
            supervisor: data2[j][2],
            ts: data2[j][5] ? data2[j][5].getTime() : 0
          });
        }
      }
      return jsonResponse({status:'ok',turnos:turnos});
    }
    
    return jsonResponse({status:'ok',message:'HEMCO Reporte API activa'});
    
  } catch (error) {
    return jsonResponse({status:'error',message:error.toString()});
  }
}

/* ═══ HELPERS ═══ */

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sheet;
}

function buscarFila(sheet, fecha, turno) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === fecha && data[i][1] === turno) {
      return i + 1;
    }
  }
  return -1;
}

/**
 * Guarda parámetros de una sección expandiendo claves horarias (_h1 a _h8)
 */
function guardarSeccion(ss, sheetName, fecha, turno, valores, prefijos) {
  // Construir headers dinámicos: Fecha, Turno + cada prefijo con sufijos horarios
  var headers = ['Fecha', 'Turno'];
  var row = [fecha, turno];
  
  prefijos.forEach(function(prefix) {
    // Buscar si tiene datos horarios (h1-h8 o h2,h4,h6,h8)
    var tieneHora = false;
    for (var h = 1; h <= 8; h++) {
      var key = prefix + '_h' + h;
      if (valores[key] !== undefined) {
        tieneHora = true;
        break;
      }
    }
    
    if (tieneHora) {
      for (var h2 = 1; h2 <= 8; h2++) {
        headers.push(prefix + '_h' + h2);
        row.push(valores[prefix + '_h' + h2] || '');
      }
    } else {
      // Valor único (no horario)
      headers.push(prefix);
      row.push(valores[prefix] || '');
    }
  });
  
  var sheet = getOrCreateSheet(ss, sheetName, headers);
  var filaExistente = buscarFila(sheet, fecha, turno);
  
  if (filaExistente > 0) {
    sheet.getRange(filaExistente, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}
