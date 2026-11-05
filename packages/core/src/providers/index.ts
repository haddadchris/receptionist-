/**
 * Provider registry. Every external integration sits behind an interface with a
 * mock implementation; real implementations are selected with env vars so the
 * whole app runs locally with zero paid API keys.
 */
import { MockWhatsAppProvider } from "./whatsapp/mock";
import type { WhatsAppProvider } from "./whatsapp/types";

type Registry = { whatsapp?: WhatsAppProvider };

const globalReg = globalThis as unknown as { __fekerteProviders?: Registry };
const reg = (): Registry => (globalReg.__fekerteProviders ??= {});

export function getWhatsAppProvider(): WhatsAppProvider {
  const r = reg();
  if (!r.whatsapp) {
    const kind = process.env.WHATSAPP_PROVIDER ?? "mock";
    switch (kind) {
      case "mock":
        r.whatsapp = new MockWhatsAppProvider();
        break;
      default:
        throw new Error(`Unknown WHATSAPP_PROVIDER "${kind}"`);
    }
  }
  return r.whatsapp;
}

/** Test hook: override providers. */
export function setProviders(overrides: Registry): void {
  Object.assign(reg(), overrides);
}

export function resetProviders(): void {
  globalReg.__fekerteProviders = {};
}
