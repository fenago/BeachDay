// Stand-in (see _standin.mts). Not product code.
import { standIn } from "./_standin.mts";
export const createRejectHandler = standIn("reject", { method: "POST", id: "proposal" });
