const SUPABASE_URL = 'https://suwaqkxkhhfopjkhsptf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1d2Fxa3hraGhmb3Bqa2hzcHRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MDI2MDQsImV4cCI6MjA5MDM3ODYwNH0.HcLs3bkZZ0lATGSQbWtTt7oIxcM8inYmLZHm2K5v39U';

// Aqui está o segredo: definimos como 'window.supabase' para que
// todos os outros arquivos (compras, vendas, etc) reconheçam a variável 'supabase'
window.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
