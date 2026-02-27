import { serve } from "bun";

import { app } from "./routes.js";

const port = parseInt(process.env.PORT || "3000", 10);

console.log(`Gryt Identity Service starting on port ${port}...`);

serve({
  fetch: app.fetch,
  port,
});

console.log(`Gryt Identity Service listening on http://0.0.0.0:${port}`);
