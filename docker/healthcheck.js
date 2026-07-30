// Container healthcheck. Uses only Node built-ins so the runtime image needs no curl or wget.
const port = process.env.PORT || "3000";

fetch(`http://127.0.0.1:${port}/api/health`)
  .then((response) => process.exit(response.ok ? 0 : 1))
  .catch(() => process.exit(1));
