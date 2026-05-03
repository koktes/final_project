import { prisma } from "../utils/prisma";
import logger from "../utils/logger";

export async function isSeenTransaction(bank: string, reference: string): Promise<boolean> {
  try {
    const normalizedRef = (reference || "").toUpperCase();
    const found = await prisma.seenTransaction.findFirst({
      where: { bank, reference: normalizedRef },
    });
    return !!found;
  } catch (err) {
    logger.warn("Failed to query SeenTransaction", { err });
    // Fail open: if DB cannot be reached, let the pipeline continue to remote check
    return false;
  }
}

export async function addSeenTransaction(bank: string, reference: string): Promise<void> {
  try {
    const normalizedRef = (reference || "").toUpperCase();
    await prisma.seenTransaction.create({
      data: {
        bank,
        reference: normalizedRef,
      },
    });
  } catch (err: any) {
    // Ignore unique-constraint violations and log others
    if (err?.code === "P2002") {
      // already exists
      return;
    }
    logger.warn("Failed to insert SeenTransaction", { err });
  }
}

export async function seedSeenTransactions(entries: Array<{ bank: string; reference: string }>) {
  for (const e of entries) {
    await addSeenTransaction(e.bank, e.reference);
  }
}

export default { isSeenTransaction, addSeenTransaction, seedSeenTransactions };
