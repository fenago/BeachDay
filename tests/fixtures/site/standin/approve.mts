// Stand-in (see _standin.mts). Not product code.
import { standIn } from "./_standin.mts";
export const createApproveHandler = standIn("approve", { method: "POST", secretReader: true, id: "proposal" });
