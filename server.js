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
app.listen(PORT, () => console.log("Servidor en puerto " + PORT));
