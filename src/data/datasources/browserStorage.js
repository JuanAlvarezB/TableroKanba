// localStorage y sessionStorage pueden lanzar error (Safari con datos de sitio bloqueados);
// sin ellos, LUCAS funciona igual, solo que sin copia local ni modo sin conexión. Estas
// funciones nunca lanzan.

export function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Devuelve false si no se pudo guardar.
export function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeStorage(keys) {
  keys.forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nada que borrar si el navegador no permite usar localStorage.
    }
  });
}

export function writeSessionValue(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Sin sessionStorage el valor simplemente no se conserva.
  }
}

// Devuelve el valor guardado para esta pestaña y lo borra, o null.
export function takeSessionValue(key) {
  try {
    const value = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    return value;
  } catch {
    return null;
  }
}
