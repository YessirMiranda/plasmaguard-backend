// ============================================
// PLASMAGUARD - BACKEND (RENDER) - MULTI-SEDE + AUTH
// ============================================

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json());

// ==================== CONFIGURACIÓN ====================
const SUPABASE_URL = "https://pwfkckrafympdltinjdo.supabase.co/rest/v1/";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3Zmtja3JhZnltcGRsdGluamRvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NzE5ODMsImV4cCI6MjEwNDQ0Nzk4M30.Ys3utjYgkWrQZaJAKQT9v90Yzzv-qQH9HYIJdf8FbCo";

const DISPOSITIVOS = ['POTOSI', 'COCHABAMBA'];

const headers = {
  "apikey": SUPABASE_KEY,
  "Authorization": "Bearer " + SUPABASE_KEY,
  "Content-Type": "application/json"
};

const axiosClient = axios.create({ timeout: 10000, headers });

process.on('uncaughtException', (err) => {
  console.error('💥 UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('💥 UNHANDLED REJECTION:', reason);
});

// ==================== FUNCIONES AUXILIARES ====================

async function enviarNotificacionMessenger(apiKey, mensaje) {
  try {
    const apiKeyLimpia = apiKey.trim().replace(/[\s\u200B\u200C\u200D\uFEFF]/g, '');
    const url = `https://api.callmebot.com/facebook/send.php?apikey=${apiKeyLimpia}&text=${encodeURIComponent(mensaje)}`;
    const response = await axiosClient.get(url);
    return true;
  } catch (error) {
    console.error("Error enviando notificación:", error.message);
    return false;
  }
}

async function verificarYNotificar() {
  try {
    const configResp = await axiosClient.get(SUPABASE_URL + "configuracion?select=*");
    const config = {};
    configResp.data.forEach(c => { config[c.clave] = c.valor; });

    if (config.notificaciones_activas !== 'true') return;

    for (const dispId of DISPOSITIVOS) {
      try {
        const resp = await axiosClient.get(
          SUPABASE_URL + `registros?dispositivo_id=eq.${dispId}&select=*&order=id.desc&limit=1`
        );
        if (resp.data.length === 0) continue;
        const d = resp.data[0];

        const ultimoRegistro = new Date(d.created_at).getTime();
        const diferenciaMinutos = (Date.now() - ultimoRegistro) / 60000;
        if (diferenciaMinutos > 2) continue;

        let falla = null;
        if (!d.estado_ac) {
          falla = { tipo: 'apagon', mensaje: `⚡ APAGÓN en ${dispId}. Sistema en batería.` };
        } else if (d.sensor_1 !== -127 && (d.sensor_1 > parseFloat(config.temp_maxima) || d.sensor_1 < parseFloat(config.temp_minima))) {
          falla = { tipo: 'temp_alta', mensaje: `🌡️ Temperatura anormal en ${dispId} - S1: ${d.sensor_1.toFixed(1)}°C` };
        } else if (d.sensor_2 !== -127 && (d.sensor_2 > parseFloat(config.temp_maxima) || d.sensor_2 < parseFloat(config.temp_minima))) {
          falla = { tipo: 'temp_alta', mensaje: `🌡️ Temperatura anormal en ${dispId} - S2: ${d.sensor_2.toFixed(1)}°C` };
        } else if (d.sensor_3 !== -127 && (d.sensor_3 > parseFloat(config.temp_maxima) || d.sensor_3 < parseFloat(config.temp_minima))) {
          falla = { tipo: 'temp_alta', mensaje: `🌡️ Temperatura anormal en ${dispId} - S3: ${d.sensor_3.toFixed(1)}°C` };
        } else if (d.voltaje_bateria <= parseFloat(config.voltaje_corte)) {
          falla = { tipo: 'bateria_baja', mensaje: `🔋 Batería baja en ${dispId}. V: ${d.voltaje_bateria.toFixed(2)}V` };
        }

        if (!falla) continue;

        const cincoMinAtras = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const notifResp = await axiosClient.get(
          SUPABASE_URL + `notificaciones?dispositivo_id=eq.${dispId}&tipo=eq.${falla.tipo}&created_at=gte.${cincoMinAtras}`
        );
        if (notifResp.data.length > 0) continue;

        const destResp = await axiosClient.get(SUPABASE_URL + "destinatarios?activo=eq.true");
        const destinatarios = destResp.data;
        if (destinatarios.length === 0) continue;

        for (const dest of destinatarios) {
          const enviado = await enviarNotificacionMessenger(dest.apikey, falla.mensaje);
          try {
            await axiosClient.post(SUPABASE_URL + "notificaciones", {
              dispositivo_id: dispId,
              tipo: falla.tipo,
              mensaje: falla.mensaje,
              destinatario: dest.nombre,
              canal: 'messenger',
              estado: enviado ? 'enviado' : 'fallido'
            });
          } catch (err) {
            console.error(`Error registrando notif: ${err.message}`);
          }
        }
      } catch (err) {
        console.error(`Error procesando ${dispId}:`, err.message);
      }
    }
  } catch (error) {
    console.error("Error general verificarYNotificar:", error.message);
  }
}

// ==================== RUTAS ====================

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// --- LOGIN ---
app.post('/api/login', async (req, res) => {
  const { usuario, password } = req.body;
  if (!usuario || !password) {
    return res.status(400).json({ error: "Faltan usuario o contraseña" });
  }
  try {
    const resp = await axiosClient.get(
      SUPABASE_URL + `usuarios?usuario=eq.${encodeURIComponent(usuario)}&activo=eq.true&limit=1`
    );
    if (resp.data.length === 0) {
      return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
    }
    const u = resp.data[0];

    if (!u.password || (!u.password.startsWith('$2a$') && !u.password.startsWith('$2b$'))) {
      console.error(`⚠️ Usuario ${u.usuario} tiene password sin hashear. Migrar.`);
      return res.status(500).json({ error: "Error de configuración de usuario. Contacte al administrador." });
    }

    const valido = await bcrypt.compare(password, u.password);
    if (!valido) {
      return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
    }

    res.json({
      usuario: u.usuario,
      nombre: u.nombre,
      rol: u.rol,
      institucion: u.institucion || 'potosi'
    });
  } catch (error) {
    console.error("Error en login:", error.message);
    res.status(500).json({ error: "Error interno al iniciar sesión" });
  }
});

// --- Último registro (por sede o global) ---
app.get('/api/ultimo', async (req, res) => {
  const { dispositivo_id } = req.query;
  try {
    let url = SUPABASE_URL + "registros?select=*&order=id.desc&limit=1";
    if (dispositivo_id) url += `&dispositivo_id=eq.${dispositivo_id}`;
    const response = await axiosClient.get(url);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener datos", detalle: error.message });
  }
});

app.get('/api/ultimos', async (req, res) => {
  try {
    const resultado = {};
    for (const dispId of DISPOSITIVOS) {
      const r = await axiosClient.get(
        SUPABASE_URL + `registros?dispositivo_id=eq.${dispId}&select=*&order=id.desc&limit=1`
      );
      resultado[dispId] = r.data[0] || null;
    }
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener últimos", detalle: error.message });
  }
});

app.get('/api/temperaturas', async (req, res) => {
  const { inicio, fin, intervalo, dispositivo_id } = req.query;
  try {
    let todosLosDatos = [];
    let offset = 0;
    const limit = 1000;
    let hayMas = true;

    while (hayMas) {
      let url = SUPABASE_URL + `registros?select=*&order=created_at.asc&limit=${limit}&offset=${offset}`;
      if (inicio) url += `&created_at=gte.${inicio}`;
      if (fin) url += `&created_at=lte.${fin}`;
      if (dispositivo_id) url += `&dispositivo_id=eq.${dispositivo_id}`;
      const response = await axiosClient.get(url);
      const datos = response.data;
      if (datos.length === 0) hayMas = false;
      else {
        todosLosDatos = todosLosDatos.concat(datos);
        offset += limit;
        if (datos.length < limit) hayMas = false;
      }
    }

    let datos = todosLosDatos;
    if (intervalo && intervalo > 0) {
      const filtrados = [];
      const intervalMs = intervalo * 1000;
      datos.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      if (datos.length > 0) {
        const primerTimestamp = new Date(datos[0].created_at).getTime();
        let siguienteTimestamp = primerTimestamp;
        for (let i = 0; i < datos.length; i++) {
          const ts = new Date(datos[i].created_at).getTime();
          if (ts >= siguienteTimestamp) {
            filtrados.push(datos[i]);
            siguienteTimestamp = ts + intervalMs;
          }
        }
      }
      datos = filtrados;
    }

    res.json(datos);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener temperaturas", detalle: error.message });
  }
});

app.get('/api/fallas', async (req, res) => {
  const { inicio, fin, dispositivo_id } = req.query;
  try {
    let url = SUPABASE_URL + "registros?select=*&order=created_at.asc";
    if (inicio) url += `&created_at=gte.${inicio}`;
    if (fin) url += `&created_at=lte.${fin}`;
    if (dispositivo_id) url += `&dispositivo_id=eq.${dispositivo_id}`;
    const response = await axiosClient.get(url);
    const datos = response.data;

    const fallas = [];
    let fallaActual = null;
    datos.forEach(d => {
      let tipoFalla = null;
      let detalle = '';
      if (d.estado_ac === false) { tipoFalla = 'Apagón'; detalle = 'Sin energía eléctrica'; }
      else if (d.sensor_1 !== -127 && (d.sensor_1 > -20 || d.sensor_1 < -40)) { tipoFalla = 'Temperatura'; detalle = `Sensor 1: ${d.sensor_1}°C`; }
      else if (d.sensor_2 !== -127 && (d.sensor_2 > -20 || d.sensor_2 < -40)) { tipoFalla = 'Temperatura'; detalle = `Sensor 2: ${d.sensor_2}°C`; }
      else if (d.sensor_3 !== -127 && (d.sensor_3 > -20 || d.sensor_3 < -40)) { tipoFalla = 'Temperatura'; detalle = `Sensor 3: ${d.sensor_3}°C`; }

      if (tipoFalla) {
        if (!fallaActual || fallaActual.tipo !== tipoFalla) {
          if (fallaActual) fallas.push(fallaActual);
          fallaActual = { inicio: d.created_at, fin: d.created_at, tipo: tipoFalla, detalle, duracion: 0, dispositivo_id: d.dispositivo_id };
        } else {
          fallaActual.fin = d.created_at;
        }
      } else {
        if (fallaActual) { fallas.push(fallaActual); fallaActual = null; }
      }
    });
    if (fallaActual) fallas.push(fallaActual);
    fallas.forEach(f => {
      f.duracion = Math.round((new Date(f.fin).getTime() - new Date(f.inicio).getTime()) / 1000);
    });
    res.json(fallas);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener fallas", detalle: error.message });
  }
});

app.post('/api/comando', async (req, res) => {
  const { comando, valor, dispositivo_id } = req.body;
  if (!dispositivo_id) return res.status(400).json({ error: "Falta dispositivo_id" });
  try {
    await axiosClient.post(SUPABASE_URL + "comandos", {
      dispositivo_id,
      comando,
      valor: valor || null,
      estado: "pendiente"
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Error al enviar comando", detalle: error.message });
  }
});

app.get('/api/usuarios', async (req, res) => {
  try {
    const { rol } = req.query;
    let url = SUPABASE_URL + "usuarios?select=id,usuario,nombre,rol,institucion,celular,correo,activo,created_at";
    if (rol) url += `&rol=eq.${rol}`;
    const response = await axiosClient.get(url);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener usuarios" });
  }
});

app.post('/api/usuarios', async (req, res) => {
  const { usuario, password, nombre, rol, institucion, celular, correo } = req.body;

  if (!usuario || !password || !nombre || !rol) {
    return res.status(400).json({ error: "Faltan campos obligatorios" });
  }

  try {
    const existe = await axiosClient.get(
      SUPABASE_URL + `usuarios?usuario=eq.${encodeURIComponent(usuario)}&limit=1`
    );
    if (existe.data.length > 0) {
      return res.status(409).json({ error: "Ya existe un usuario con ese CI" });
    }

    const hash = await bcrypt.hash(password, 10);

    await axiosClient.post(SUPABASE_URL + "usuarios", {
      usuario, password: hash, nombre, rol, institucion, celular, correo, activo: true
    });
    res.json({ success: true, data: { usuario, nombre, rol, institucion } });
  } catch (error) {
    console.error("Error al crear usuario:", error.message);
    res.status(500).json({
      error: "Error al crear usuario",
      detalle: error.response ? error.response.data : error.message
    });
  }
});

app.delete('/api/usuarios/:id', async (req, res) => {
  try {
    await axiosClient.delete(`${SUPABASE_URL}usuarios?id=eq.${req.params.id}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar usuario" });
  }
});

app.get('/api/auditoria', async (req, res) => {
  try {
    const response = await axiosClient.get(SUPABASE_URL + "auditoria?select=*&order=created_at.desc&limit=100");
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener auditoría" });
  }
});

app.post('/api/auditoria', async (req, res) => {
  const { usuario, accion, detalles } = req.body;
  try {
    await axiosClient.post(SUPABASE_URL + "auditoria", { usuario, accion, detalles });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Error al guardar auditoría" });
  }
});

app.delete('/api/datos/:id', async (req, res) => {
  try {
    await axiosClient.delete(`${SUPABASE_URL}registros?id=eq.${req.params.id}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar dato" });
  }
});

app.delete('/api/fallas/borrar', async (req, res) => {
  const { inicio, fin } = req.query;
  if (!inicio || !fin) return res.status(400).json({ error: "Se requieren fechas de inicio y fin" });
  try {
    await axiosClient.delete(`${SUPABASE_URL}registros?created_at=gte.${inicio}&created_at=lte.${fin}`);
    res.json({ success: true, mensaje: `Registros borrados entre ${inicio} y ${fin}` });
  } catch (error) {
    res.status(500).json({ error: "Error al borrar registros", detalle: error.message });
  }
});

app.get('/api/configuracion', async (req, res) => {
  try {
    const response = await axiosClient.get(SUPABASE_URL + "configuracion?select=*");
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener configuración" });
  }
});

app.post('/api/configuracion', async (req, res) => {
  try {
    const config = req.body;
    for (const [clave, valor] of Object.entries(config)) {
      const existe = await axiosClient.get(SUPABASE_URL + `configuracion?clave=eq.${clave}`);
      if (existe.data.length > 0) {
        await axiosClient.patch(SUPABASE_URL + `configuracion?clave=eq.${clave}`, { valor });
      } else {
        await axiosClient.post(SUPABASE_URL + "configuracion", { clave, valor, descripcion: '' });
      }
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Error al guardar configuración" });
  }
});

app.post('/api/notificaciones/probar', async (req, res) => {
  try {
    const configResp = await axiosClient.get(SUPABASE_URL + "configuracion?select=*");
    const config = {};
    configResp.data.forEach(c => { config[c.clave] = c.valor; });
    if (!config.messenger_apikey) return res.status(400).json({ error: "No hay API Key configurada" });
    const mensaje = "🧪 PRUEBA DE NOTIFICACIÓN - PlasmaGuard funcionando correctamente.";
    const enviado = await enviarNotificacionMessenger(config.messenger_apikey, mensaje);
    if (enviado) res.json({ success: true, mensaje: "Notificación enviada" });
    else res.status(500).json({ error: "Error al enviar notificación" });
  } catch (error) {
    res.status(500).json({ error: "Error al enviar notificación" });
  }
});

app.post('/api/config/autoborrado', async (req, res) => {
  const { frecuencia, dias } = req.body;
  try {
    await axiosClient.post(SUPABASE_URL + "configuracion", {
      clave: 'autoborrado',
      valor: JSON.stringify({ frecuencia, dias })
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Error al guardar configuración" });
  }
});

app.post('/api/comando/wifi', async (req, res) => {
  const { ssid1, pass1, ssid2, pass2, dispositivo_id } = req.body;
  if (!dispositivo_id) return res.status(400).json({ error: "Falta dispositivo_id" });
  try {
    const valor = `${ssid1},${pass1},${ssid2 || ''},${pass2 || ''}`;
    await axiosClient.post(SUPABASE_URL + "comandos", {
      dispositivo_id,
      comando: "set_wifi",
      valor,
      estado: "pendiente"
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Error al enviar comando WiFi", detalle: error.message });
  }
});

app.get('/api/destinatarios', async (req, res) => {
  try {
    const response = await axiosClient.get(SUPABASE_URL + "destinatarios?select=*&order=id.asc");
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener destinatarios" });
  }
});

app.post('/api/destinatarios', async (req, res) => {
  const { nombre, apikey, institucion } = req.body;
  try {
    const response = await axiosClient.post(SUPABASE_URL + "destinatarios", {
      nombre, apikey, institucion, activo: true
    });
    res.json({ success: true, data: response.data });
  } catch (error) {
    res.status(500).json({ error: "Error al crear destinatario", detalle: error.message });
  }
});

app.patch('/api/destinatarios/:id', async (req, res) => {
  const { nombre, apikey, activo, institucion } = req.body;
  try {
    const updateData = {};
    if (nombre !== undefined) updateData.nombre = nombre;
    if (apikey !== undefined) updateData.apikey = apikey;
    if (activo !== undefined) updateData.activo = activo;
    if (institucion !== undefined) updateData.institucion = institucion;
    await axiosClient.patch(`${SUPABASE_URL}destinatarios?id=eq.${req.params.id}`, updateData);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Error al actualizar destinatario" });
  }
});

app.delete('/api/destinatarios/:id', async (req, res) => {
  try {
    await axiosClient.delete(`${SUPABASE_URL}destinatarios?id=eq.${req.params.id}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar destinatario" });
  }
});

app.use((err, req, res, next) => {
  console.error('💥 ERROR MIDDLEWARE:', err.message);
  res.status(500).json({ error: 'Error interno', detalle: err.message });
});

// ==================== INICIAR SERVIDOR ====================
const PORT = process.env.PORT || 3000;
verificarYNotificar();
setInterval(verificarYNotificar, 60000);
app.listen(PORT, () => console.log("Servidor en puerto " + PORT));
