// CLI wrapper for the offline demo. Excluded from coverage (entry point only).
import { runDemo } from "./demo.js";
runDemo().then((code) => process.exit(code));
