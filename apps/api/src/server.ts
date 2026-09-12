import { app } from "./app.js";

const port = 4000;

app.listen(port, "127.0.0.1", () => {
  console.log(`FairGate API is running at http://127.0.0.1:${port}`);
});
