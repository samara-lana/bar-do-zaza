/**
 * Banco do site e do admin (Supabase). A chave abaixo é a pública ("anon"):
 * ela só deixa ler o cardápio. Comandas e edição exigem o login do admin.
 * Vazio = o site mostra só o conteúdo de assets/dados-padrao.js.
 */
window.SUPABASE_URL = "https://jezxejsellwjyxunsxfn.supabase.co";
window.SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplenhlanNlbGx3anl4dW5zeGZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExNTAwOTgsImV4cCI6MjEwNjcyNjA5OH0.fR6AEdwDRyCpju98K-ZYzKA1EqaOIwlw7e1aD5AsDvI";
// Usuário do admin no Supabase. Na tela de login o Zazá digita só a senha.
window.ADMIN_EMAIL = "zaza@bar-do-zaza.app";
