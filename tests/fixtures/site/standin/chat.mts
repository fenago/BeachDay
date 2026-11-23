// Stand-in (see _standin.mts). Not product code.
import { standIn } from "./_standin.mts";
export const createChatHandler = standIn("chat", { method: "POST", secretReader: true });
