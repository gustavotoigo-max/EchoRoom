// O código reaproveitado do site usa import.meta.env (Vite). No app, essas
// partes são trocadas pelas versões de src/platform (ver metro.config.js);
// a declaração só existe para a checagem de tipos.
interface ImportMeta {
  readonly env: Record<string, string | undefined>
}
