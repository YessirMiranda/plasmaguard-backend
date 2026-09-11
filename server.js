// ============================================
// PLASMAGUARD - BACKEND (RENDER)
// ============================================

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// ==================== CONFIGURACIÓN ====================
const SUPABASE_URL = "https://pwfkckrafympdltinjdo.supabase.co/rest/v1/";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3Zmtja3JhZnltcGRsdGluamRvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NzE5ODMsImV4cCI6MjEwNDQ0Nzk4M30.Ys3utjYgkWrQZaJAKQT9v90Yzzv-qQH9HYIJdf8FbCo";

const headers = {
  "apikey": SUPABASE_KEY,
  "Authorization": "Bearer " + SUPABASE_KEY,
  "Content-Type": "application/json"
};

// ==================== FUNCIONES AUXILIARES ====================

async function enviarNotificacionMessenger(apiKey, mensaje) {
  try {
    const apiKeyLimpia = apiKey.trim().replace(/[\s\u200B\u200C\u200D\uFEFF]/g, '');
    const url = `https://api.callmebot.com/facebook/send.php?apikey=${apiKeyLimpia}&text=${encodeURIComponent(mensaje)}`;
    console.log("URL de notificación:", url);
    const response = await axios.get(url);
    console.log("Respuesta de CallMeBot:", response.data);
    return true;
  } catch (error) {
    console.error("Error enviando notificación:", error.message);
    return false;
  }
}

async function verificarYNotificar() {
  console.log("🔍 [NOTIF] Iniciando verificación...");
  
  try {
    // Leer configuración
    const configResp = await axios.get(SUPABASE_URL + "configuracion?select=*", { headers });
    const config = {};
    configResp.data.forEach(c => { config[c.clave] = c.valor; });

    console.log("🔍 [NOTIF] Configuración:", {
      notificaciones_activas: config.notificaciones_activas,
      messenger_apikey: config.messenger_apikey ? '***' + config.messenger_apikey.slice(-4) : 'NO CONFIGURADA',
      temp_maxima: config.temp_maxima,
      temp_minima: config.temp_minima,
      voltaje_corte: config.voltaje_corte
    });

    // Si las notificaciones están desactivadas, salir
    if (config.notificaciones_activas !== 'true') {
      console.log("🔍 [NOTIF] Notificaciones desactivadas. Saliendo.");
      return;
    }
    if (!config.messenger_apikey) {
      console.log("🔍 [NOTIF] No hay API Key configurada. Saliendo.");
      return;
    }

    // Leer último registro
    const resp = await axios.get(SUPABASE_URL + "registros?select=*&order=id.desc&limit=1", { headers });
    if (resp.data.length === 0) {
      console.log("🔍 [NOTIF] No hay registros. Saliendo.");
      return;
    }

    const d = resp.data[0];
    console.log("🔍 [NOTIF] Último registro:", {
      id: d.id,
      sensor_1: d.sensor_1,
      sensor_2: d.sensor_2,
      estado_ac: d.estado_ac,
      voltaje_bateria: d.voltaje_bateria
    });

    let falla = null;

    // Detectar fallas
    if (!d.estado_ac) {
      falla = { tipo: 'apagon', mensaje: '⚡ APAGÓN detectado en el banco de sangre. El sistema está en modo batería.' };
      console.log("🔍 [NOTIF] Falla detectada: APAGÓN");
    } else if (d.sensor_1 !== -127 && (d.sensor_1 > parseFloat(config.temp_maxima) || d.sensor_1 < parseFloat(config.temp_minima))) {
      falla = { tipo: 'temp_alta', mensaje: `🌡️ ALERTA: Temperatura anormal en Sensor 1: ${d.sensor_1.toFixed(1)}°C` };
      console.log("🔍 [NOTIF] Falla detectada: TEMP ALTA S1");
    } else if (d.sensor_2 !== -127 && (d.sensor_2 > parseFloat(config.temp_maxima) || d.sensor_2 < parseFloat(config.temp_minima))) {
      falla = { tipo: 'temp_alta', mensaje: `🌡️ ALERTA: Temperatura anormal en Sensor 2: ${d.sensor_2.toFixed(1)}°C` };
      console.log("🔍 [NOTIF] Falla detectada: TEMP ALTA S2");
    } else if (d.voltaje_bateria <= parseFloat(config.voltaje_corte)) {
      falla = { tipo: 'bateria_baja', mensaje: `🔋 ALERTA: Batería baja. Voltaje: ${d.voltaje_bateria.toFixed(2)}V` };
      console.log("🔍 [NOTIF] Falla detectada: BATERÍA BAJA");
    }

    if (falla) {
      // Verificar si ya se notificó esta falla en los últimos 5 minutos
      const cincoMinAtras = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const notifResp = await axios.get(SUPABASE_URL + `notificaciones?tipo=eq.${falla.tipo}&created_at=gte.${cincoMinAtras}`, { headers });
      
      if (notifResp.data.length > 0) {
        console.log("🔍 [NOTIF] Ya se notificó esta falla recientemente. Saliendo.");
        return;
      }

      console.log("🔍 [NOTIF] Enviando notificación:", falla.mensaje);
      const enviado = await enviarNotificacionMessenger(config.messenger_apikey, falla.mensaje);
      
      // Guardar en tabla notificaciones
      try {
        await axios.post(SUPABASE_URL + "notificaciones", {
          dispositivo_id: d.dispositivo_id,
          tipo: falla.tipo,
          mensaje: falla.mensaje,
          destinatario: 'Messenger',
          canal: 'messenger',
          estado: enviado ? 'enviado' : 'fallido'
        }, { headers });
        console.log("🔍 [NOTIF] Notificación guardada en Supabase.");
      } catch (err) {
        console.error("🔍 [NOTIF] Error guardando notificación:", err.message);
      }
    } else {
      console.log("🔍 [NOTIF] No se detectaron fallas.");
    }
  } catch (error) {
    console.error("🔍 [NOTIF] Error general:", error.message);
  }
}

// ==================== RUTAS ====================

// --- Último registro ---
app.get('/api/ultimo', async (req, res) => {
  try {
    const response = await axios.get(SUPABASE_URL + "registros?select=*&order=id.desc&limit=1", { headers });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener datos", detalle: error.message });
  }
});

// --- Histórico de temperaturas ---
app.get('/api/temperaturas', async (req, res) => {
  const { inicio, fin, intervalo } = req.query;
  try {
    let url = SUPABASE_URL + "registros?select=*&order=created_at.asc";
    if (inicio) url += `&created_at=gte.${inicio}`;
    if (fin) url += `&created_at=lte.${fin}`;
    
    const response = await axios.get(url, { headers });
    let datos = response.data;
    
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

// --- Histórico de fallas ---
app.get('/api/fallas', async (req, res) => {
  const { inicio, fin } = req.query;
  try {
    let url = SUPABASE_URL + "registros?select=*&order=created_at.asc";
    if (inicio) url += `&created_at=gte.${inicio}`;
    if (fin) url += `&created_at=lte.${fin}`;
    
    const response = await axios.get(url, { headers });
    const datos = response.data;
    
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
    
    fallas.forEach(f => {
      const inicio = new Date(f.inicio).getTime();
      const fin = new Date(f.fin).getTime();
      f.duracion = Math.round((fin - inicio) / 1000);
    });
    
    res.json(fallas);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener fallas", detalle: error.message });
  }
});

// --- Enviar comando ---
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

// --- Usuarios ---
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

app.delete('/api/usuarios/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await axios.delete(`${SUPABASE_URL}usuarios?id=eq.${id}`, { headers });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar usuario" });
  }
});

// --- Auditoría ---
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

// --- Datos individuales ---
app.delete('/api/datos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await axios.delete(`${SUPABASE_URL}registros?id=eq.${id}`, { headers });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar dato" });
  }
});

// --- Borrar fallas por rango ---
app.delete('/api/fallas/borrar', async (req, res) => {
  const { inicio, fin } = req.query;
  
  if (!inicio || !fin) {
    return res.status(400).json({ error: "Se requieren fechas de inicio y fin" });
  }

  try {
    const url = `${SUPABASE_URL}registros?created_at=gte.${inicio}&created_at=lte.${fin}`;
    await axios.delete(url, { headers });
    res.json({ success: true, mensaje: `Registros borrados entre ${inicio} y ${fin}` });
  } catch (error) {
    console.error("Error borrando notificaciones:", error.message);
    res.status(500).json({ error: "Error al borrar notificaciones", detalle: error.message });
  }
});

// --- Configuración ---
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

// --- Probar notificación ---
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

// --- Configuración auto-borrado ---
app.post('/api/config/autoborrado', async (req, res) => {
  const { frecuencia, dias } = req.body;
  try {
    await axios.post(SUPABASE_URL + "configuracion", {
      clave: 'autoborrado',
      valor: JSON.stringify({ frecuencia, dias })
    }, { headers });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Error al guardar configuración" });
  }
});

// ==================== INICIAR SERVIDOR ====================
const PORT = process.env.PORT || 3000;

// Ejecutar inmediatamente al iniciar
console.log("🔍 [NOTIF] Iniciando sistema de notificaciones...");
verificarYNotificar();

// Luego cada 60 segundos
setInterval(() => {
  console.log("🔍 [NOTIF] Ejecutando verificación periódica...");
  verificarYNotificar();
}, 60000);

app.listen(PORT, () => console.log("Servidor en puerto " + PORT));
