import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  /*
   * Lo compilado vive en `/build/`, aparte de `/assets/`.
   *
   * Vite pone su salida con huella en `assets/`, que es también donde `public/`
   * deja los SVG copiados tal cual. Mezclados, no hay forma de mirar una ruta y
   * saber si su nombre garantiza su contenido: `index-BMdgMbJP.css` no puede
   * cambiar sin cambiar de nombre, `vera_map.svg` sí. De esa distinción depende
   * qué se puede guardar para siempre y qué hay que volver a preguntar, y
   * adivinarla por la forma del nombre falla justo en los casos raros
   * —`LICENSE-IBM-Plex.txt` parece llevar huella y no lleva—.
   *
   * Separarlos convierte la pregunta en el prefijo de la ruta, que no se
   * equivoca. El servidor y el service worker leen los dos la misma regla.
   */
  build: { outDir: 'dist', assetsDir: 'build', emptyOutDir: true, target: 'es2023' },
  publicDir: 'public',
  server: {
    // En desarrollo el cliente habla con el servidor local de Vera.
    proxy: Object.fromEntries(
      ['/operations', '/pages', '/search', '/graph', '/ops', '/health', '/invariants'].map((p) => [
        p,
        { target: 'http://localhost:4173', changeOrigin: true },
      ]),
    ),
  },
});
