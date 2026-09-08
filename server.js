const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const SUPABASE_URL = "https://pwfkckrafympdltinjdo.supabase.co/rest/v1/";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3Zmtja3JhZnltcGRsdGluamRvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NzE5ODMsImV4cCI6MjEwNDQ0Nzk4M30.Ys3utjYgkWrQZaJAKQT9v90Yzzv-qQH9HYIJdf8FbCo";

// Ruta para leer el último registro
app.get('/api/ultimo', async (req, res) => {
  try {
    const response = await axios.get(SUPABASE_URL + "registros?select=*&order=created_at.desc&limit=1", {
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": "Bearer " + SUPABASE_KEY
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error("Error al obtener datos:", error.message); // Mostrar en logs de Render
    res.status(500).json({ error: "Error al obtener datos", detalle: error.message });
  }
});

// Ruta para insertar un comando
app.post('/api/comando', async (req, res) => {
  const { comando } = req.body;
  try {
    const response = await axios.post(SUPABASE_URL + "comandos", {
      dispositivo_id: "POTOSI",
      comando: comando,
      valor: null,
      estado: "pendiente"
    }, {
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": "Bearer " + SUPABASE_KEY,
        "Content-Type": "application/json"
      }
    });
    res.json({ success: true, data: response.data });
  } catch (error) {
    res.status(500).json({ error: "Error al enviar comando" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor escuchando en puerto " + PORT);
});
