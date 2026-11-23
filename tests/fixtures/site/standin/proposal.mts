// Stand-in (see _standin.mts). Not product code.
import { standIn } from "./_standin.mts";
export const createProposalHandler = standIn("proposal", { method: "GET", secretReader: true, id: "proposal" });
