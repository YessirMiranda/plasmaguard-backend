// migrar_passwords.js
const axios = require('axios');
const bcrypt = require('bcryptjs');

const SUPABASE_URL = "https://pwfkckrafympdltinjdo.supabase.co/rest/v1/";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3Zmtja3JhZnltcGRsdGluamRvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NzE5ODMsImV4cCI6MjEwNDQ0Nzk4M30.Ys3utjYgkWrQZaJAKQT9v90Yzzv-qQH9HYIJdf8FbCo";

const headers = {
  "apikey": SUPABASE_KEY,
  "Authorization": "Bearer " + SUPABASE_KEY,
  "Content-Type": "application/json"
};

async function migrar() {
  console.log("🔄 Leyendo usuarios...");
  const resp = await axios.get(SUPABASE_URL + "usuarios?select=*", { headers });
  const usuarios = resp.data;
  console.log(`👥 ${usuarios.length} usuarios encontrados`);

  for (const u of usuarios) {
    // Si ya está hasheada (empieza con $2a$ o $2b$), saltar
    if (u.password && (u.password.startsWith('$2a$') || u.password.startsWith('$2b$'))) {
      console.log(`⏭️  ${u.usuario}: ya tiene hash, saltando`);
      continue;
    }
    if (!u.password) {
      console.log(`⚠️  ${u.usuario}: sin contraseña, saltando`);
      continue;
    }

    const hash = await bcrypt.hash(u.password, 10);
    await axios.patch(
      `${SUPABASE_URL}usuarios?id=eq.${u.id}`,
      { password: hash },
      { headers }
    );
    console.log(`✅ ${u.usuario}: migrado`);
  }
  console.log("🎉 Migración completada");
}

migrar().catch(err => console.error("❌ Error:", err.response ? err.response.data : err.message));