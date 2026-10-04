// Inicio de LUCAS (index.html): exige sesión, saluda y muestra las funciones disponibles.
async function startHome() {
  const session = await LUCAS_AUTH.requireSession();

  document.getElementById('user-name').textContent = session.name;
  LUCAS_CUENTA.mount(session, document.getElementById('account'));

  // Fuera de PDN se marca la página como Desarrollo.
  if (APP_ENV.name === 'dev') {
    document.title = `[DEV] ${document.title}`;
    document.getElementById('env-badge').hidden = false;
  }
}

startHome();
