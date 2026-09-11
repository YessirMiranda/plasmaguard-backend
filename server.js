const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const SUPABASE_URL = "https://pwfkckrafympdltinjdo.supabase.co/rest/v1/";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3Zmtja3JhZnltcGRsdGluamRvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NzE5ODMsImV4cCI6MjEwNDQ0Nzk4M30.Ys3utjYgkWrQZaJAKQT9v90Yzzv-qQH9HYIJdf8FbCo";

const headers = {
  "apikey": SUPABASE_KEY,
  "Authorization": "Bearer " + SUPABASE_KEY,
  "Content-Type": "application/json"
};

// ==================== RUTA: ÚLTIMO REGISTRO ====================
app.get('/api/ultimo', async (req, res) => {
  try {
    const response = await axios.get(SUPABASE_URL + "registros?select=*&order=id.desc&limit=1", { headers });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener datos", detalle: error.message });
  }
});

// ==================== RUTA: HISTÓRICO DE TEMPERATURAS ====================
app.get('/api/temperaturas', async (req, res) => {
  const { inicio, fin, intervalo } = req.query;
  try {
    let url = SUPABASE_URL + "registros?select=*&order=created_at.asc";
    if (inicio) url += `&created_at=gte.${inicio}`;
    if (fin) url += `&created_at=lte.${fin}`;
    
    const response = await axios.get(url, { headers });
    let datos = response.data;
    
    // Filtrar por intervalo (cada X segundos)
    if (intervalo && intervalo > 0) {
      const filtrados = [];
      let ultimoTimestamp = 0;
      datos.forEach(d => {
        const ts = new Date(d.created_at).getTime();
        if (ts - ultimoTimestamp >= intervalo * 1000) {
          filtrados.push(d);
          ultimoTimestamp = ts;
        }
      });
      datos = filtrados;
    }
    
    res.json(datos);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener temperaturas", detalle: error.message });
  }
});

// ==================== RUTA: HISTÓRICO DE FALLAS ====================
app.get('/api/fallas', async (req, res) => {
  const { inicio, fin } = req.query;
  try {
    let url = SUPABASE_URL + "registros?select=*&order=created_at.asc";
    if (inicio) url += `&created_at=gte.${inicio}`;
    if (fin) url += `&created_at=lte.${fin}`;
    
    const response = await axios.get(url, { headers });
    const datos = response.data;
    
    // Detectar fallas (temperatura fuera de rango o apagón)
    const fallas = [];
    let fallaActual = null;
    
    datos.forEach(d => {
      let tipoFalla = null;
      let detalle = '';
      
      if (d.estado_ac === false) {
        tipoFalla = 'Apagón';
        detalle = 'Sin energía eléctrica';
      } else if (d.sensor_1 !== -127 && (d.sensor_1 > -20 || d.sensor_1 < -40)) {
        tipoFalla = 'Temperatura';
        detalle = `Sensor 1: ${d.sensor_1}°C`;
      } else if (d.sensor_2 !== -127 && (d.sensor_2 > -20 || d.sensor_2 < -40)) {
        tipoFalla = 'Temperatura';
        detalle = `Sensor 2: ${d.sensor_2}°C`;
      } else if (d.sensor_3 !== -127 && (d.sensor_3 > -20 || d.sensor_3 < -40)) {
        tipoFalla = 'Temperatura';
        detalle = `Sensor 3: ${d.sensor_3}°C`;
      }
      
      if (tipoFalla) {
        if (!fallaActual || fallaActual.tipo !== tipoFalla) {
          if (fallaActual) fallas.push(fallaActual);
          fallaActual = {
            inicio: d.created_at,
            fin: d.created_at,
            tipo: tipoFalla,
            detalle: detalle,
            duracion: 0
          };
        } else {
          fallaActual.fin = d.created_at;
        }
      } else {
        if (fallaActual) {
          fallas.push(fallaActual);
          fallaActual = null;
        }
      }
    });
    
    if (fallaActual) fallas.push(fallaActual);
    
    // Calcular duración
    fallas.forEach(f => {
      const inicio = new Date(f.inicio).getTime();
      const fin = new Date(f.fin).getTime();
      f.duracion = Math.round((fin - inicio) / 1000); // segundos
    });
    
    res.json(fallas);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener fallas", detalle: error.message });
  }
});

// ==================== RUTA: COMANDO ====================
app.post('/api/comando', async (req, res) => {
  const { comando, valor } = req.body;
  try {
    await axios.post(SUPABASE_URL + "comandos", {
      dispositivo_id: "POTOSI",
      comando: comando,
      valor: valor || null,
      estado: "pendiente"
    }, { headers });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Error al enviar comando" });
  }
});

// ==================== RUTA: USUARIOS ====================
app.get('/api/usuarios', async (req, res) => {
  try {
    const response = await axios.get(SUPABASE_URL + "usuarios?select=*", { headers });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener usuarios" });
  }
});

app.post('/api/usuarios', async (req, res) => {
  const { usuario, password, nombre, rol, institucion, celular, correo } = req.body;
  try {
    await axios.post(SUPABASE_URL + "usuarios", {
      usuario, password, nombre, rol, institucion, celular, correo, activo: true
    }, { headers });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Error al crear usuario" });
  }
});

const PORT = process.env.PORT || 3000;

// ==================== RUTA: BORRAR FALLAS ====================
app.delete('/api/fallas/borrar', async (req, res) => {
  try {
    // Borrar todas las fallas de la tabla 'registros'
    // En producción, deberías borrar solo las fallas antiguas o las seleccionadas
    const response = await axios.delete(SUPABASE_URL + "registros?estado_ac=eq.false", { headers });
    
    // También borrar las fallas de temperatura
    // (Esto es un ejemplo, en producción se debe filtrar mejor)
    
    res.json({ success: true, mensaje: "Notificaciones borradas" });
  } catch (error) {
    console.error("Error borrando notificaciones:", error.message);
    res.status(500).json({ error: "Error al borrar notificaciones", detalle: error.message });
  }
});
app.listen(PORT, () => console.log("Servidor en puerto " + PORT));

// ==================== RUTA: BORRAR FALLAS ====================
app.delete('/api/fallas/borrar', async (req, res) => {
  try {
    // Borrar todas las fallas (en producción, filtrar por fecha)
    await axios.delete(SUPABASE_URL + "registros?created_at=lt.2000-01-01", { headers });
    res.json({ success: true, mensaje: "Notificaciones borradas" });
  } catch (error) {
    res.status(500).json({ error: "Error al borrar notificaciones" });
  }
});

// ==================== RUTA: USUARIOS ====================
app.get('/api/usuarios', async (req, res) => {
  try {
    const { rol } = req.query;
    let url = SUPABASE_URL + "usuarios?select=*";
    if (rol) url += `&rol=eq.${rol}`;
    const response = await axios.get(url, { headers });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener usuarios" });
  }
});

app.delete('/api/usuarios/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await axios.delete(`${SUPABASE_URL}usuarios?id=eq.${id}`, { headers });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar usuario" });
  }
});

// ==================== RUTA: AUDITORÍA ====================
app.get('/api/auditoria', async (req, res) => {
  try {
    const response = await axios.get(SUPABASE_URL + "auditoria?select=*&order=created_at.desc&limit=100", { headers });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener auditoría" });
  }
});

app.post('/api/auditoria', async (req, res) => {
  const { usuario, accion, detalles } = req.body;
  try {
    await axios.post(SUPABASE_URL + "auditoria", { usuario, accion, detalles }, { headers });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Error al guardar auditoría" });
  }
});

// ==================== RUTA: DATOS INDIVIDUALES ====================
app.delete('/api/datos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await axios.delete(`${SUPABASE_URL}registros?id=eq.${id}`, { headers });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar dato" });
  }
});

// ==================== RUTA: CONFIGURACIÓN AUTOBORRADO ====================
app.post('/api/config/autoborrado', async (req, res) => {
  const { frecuencia, dias } = req.body;
  try {
    // Guardar en una tabla de configuración
    await axios.post(SUPABASE_URL + "configuracion", {
      clave: 'autoborrado',
      valor: JSON.stringify({ frecuencia, dias })
    }, { headers });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Error al guardar configuración" });
  }
});

// ==================== NOTIFICACIONES AUTOMÁTICAS ====================
const axios = require('axios');

async function enviarNotificacionMessenger(apiKey, mensaje) {
  try {
    // Limpiar la API Key: eliminar espacios, saltos de línea y caracteres invisibles
    const apiKeyLimpia = apiKey.trim().replace(/[\s\u200B\u200C\u200D\uFEFF]/g, '');
    
    const url = `https://api.callmebot.com/facebook/send.php?apikey=${apiKeyLimpia}&text=${encodeURIComponent(mensaje)}`;
    console.log("URL de notificación:", url); // Para depurar
    
    const response = await axios.get(url);
    console.log("Respuesta de CallMeBot:", response.data);
    return true;
  } catch (error) {
    console.error("Error enviando notificación:", error.message);
    return false;
  }
}

async function verificarYNotificar() {
  try {
    // Leer configuración
    const configResp = await axios.get(SUPABASE_URL + "configuracion?select=*", { headers });
    const config = {};
    configResp.data.forEach(c => { config[c.clave] = c.valor; });

    // Si las notificaciones están desactivadas, salir
    if (config.notificaciones_activas !== 'true') return;
    if (!config.messenger_apikey) return;

    // Leer último registro
    const resp = await axios.get(SUPABASE_URL + "registros?select=*&order=id.desc&limit=1", { headers });
    if (resp.data.length === 0) return;

    const d = resp.data[0];
    let falla = null;

    // Detectar fallas
    if (!d.estado_ac) {
      falla = { tipo: 'apagon', mensaje: '⚡ APAGÓN detectado en el banco de sangre. El sistema está en modo batería.' };
    } else if (d.sensor_1 !== -127 && (d.sensor_1 > parseFloat(config.temp_maxima) || d.sensor_1 < parseFloat(config.temp_minima))) {
      falla = { tipo: 'temp_alta', mensaje: `🌡️ ALERTA: Temperatura anormal en Sensor 1: ${d.sensor_1.toFixed(1)}°C` };
    } else if (d.sensor_2 !== -127 && (d.sensor_2 > parseFloat(config.temp_maxima) || d.sensor_2 < parseFloat(config.temp_minima))) {
      falla = { tipo: 'temp_alta', mensaje: `🌡️ ALERTA: Temperatura anormal en Sensor 2: ${d.sensor_2.toFixed(1)}°C` };
    } else if (d.voltaje_bateria <= parseFloat(config.voltaje_corte)) {
      falla = { tipo: 'bateria_baja', mensaje: `🔋 ALERTA: Batería baja. Voltaje: ${d.voltaje_bateria.toFixed(2)}V` };
    }

    if (falla) {
      // Verificar si ya se notificó esta falla en los últimos 5 minutos
      const cincoMinAtras = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const notifResp = await axios.get(SUPABASE_URL + `notificaciones?tipo=eq.${falla.tipo}&created_at=gte.${cincoMinAtras}`, { headers });
      
      if (notifResp.data.length > 0) return; // Ya se notificó recientemente

      // Enviar notificación (solo con API Key)
      const enviado = await enviarNotificacionMessenger(config.messenger_apikey, falla.mensaje);
      
      // Guardar en tabla notificaciones
      await axios.post(SUPABASE_URL + "notificaciones", {
        dispositivo_id: d.dispositivo_id,
        tipo: falla.tipo,
        mensaje: falla.mensaje,
        destinatario: 'Messenger',
        canal: 'messenger',
        estado: enviado ? 'enviado' : 'fallido'
      }, { headers });
    }
  } catch (error) {
    console.error("Error en verificación de notificaciones:", error.message);
  }
}

// Ejecutar cada 60 segundos
setInterval(verificarYNotificar, 60000);

// ==================== RUTA: CONFIGURACIÓN ====================
app.get('/api/configuracion', async (req, res) => {
  try {
    const response = await axios.get(SUPABASE_URL + "configuracion?select=*", { headers });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener configuración" });
  }
});

app.post('/api/configuracion', async (req, res) => {
  try {
    const config = req.body;
    for (const [clave, valor] of Object.entries(config)) {
      // Verificar si existe
      const existe = await axios.get(SUPABASE_URL + `configuracion?clave=eq.${clave}`, { headers });
      if (existe.data.length > 0) {
        await axios.patch(SUPABASE_URL + `configuracion?clave=eq.${clave}`, { valor }, { headers });
      } else {
        await axios.post(SUPABASE_URL + "configuracion", { clave, valor, descripcion: '' }, { headers });
      }
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Error al guardar configuración" });
  }
});

// ==================== RUTA: PROBAR NOTIFICACIÓN ====================
app.post('/api/notificaciones/probar', async (req, res) => {
  try {
    const configResp = await axios.get(SUPABASE_URL + "configuracion?select=*", { headers });
    const config = {};
    configResp.data.forEach(c => { config[c.clave] = c.valor; });
    
    if (!config.messenger_apikey) {
      return res.status(400).json({ error: "No hay API Key configurada" });
    }

    const mensaje = "🧪 PRUEBA DE NOTIFICACIÓN - PlasmaGuard funcionando correctamente.";
    const enviado = await enviarNotificacionMessenger(config.messenger_apikey, mensaje);
    
    if (enviado) {
      res.json({ success: true, mensaje: "Notificación enviada" });
    } else {
      res.status(500).json({ error: "Error al enviar notificación" });
    }
  } catch (error) {
    res.status(500).json({ error: "Error al enviar notificación" });
  }
});
