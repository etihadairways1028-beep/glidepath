import { connect } from "node:net";

/**
 * Cockpit tools that serve their own web page on the simmer's PC.
 * We only check whether something is listening on the documented port;
 * we don't talk to the add-on or change anything in it.
 */
export interface AddonDef {
  id: string;
  name: string;
  aircraft: string;
  port: number;
  path: string;
  /** How to switch it on if it isn't running. */
  help: string;
}

export const ADDONS: AddonDef[] = [
  { id: "fenix", name: "Fenix EFB and MCDU", aircraft: "Fenix A319 / A320 / A321", port: 8083, path: "/", help: "Starts with the Fenix aircraft. Load a Fenix in the sim, then refresh." },
  { id: "fslabs", name: "FSLabs EFB", aircraft: "FSLabs A321", port: 23032, path: "/", help: "Starts with the FSLabs aircraft. If you changed its port in the FSLabs settings, add it below." },
  { id: "gsx", name: "GSX Remote", aircraft: "GSX Pro (any aircraft)", port: 8744, path: "/", help: "Needs GSX Pro 4.0.6 or newer. The remote is on by default; check the GSX settings if it isn't found." },
  { id: "simbridge", name: "FlyByWire SimBridge", aircraft: "FBW A32NX / A380X", port: 8380, path: "/interfaces/mcdu/", help: "Start SimBridge from the flyPad or the FBW installer." },
];

/** Secure (https) ports that pass straight through to each add-on, so the website version can show it. */
export const ADDON_DOORS: Record<string, number> = { fenix: 4812, fslabs: 4813, gsx: 4814, simbridge: 4815 };

export interface AddonStatus extends AddonDef {
  up: boolean;
  /** https address through the Bridge's secure link, when it's running. */
  secureUrl: string | null;
  /** Same-PC address. */
  localUrl: string;
  /** Addresses other devices on the Wi-Fi can open. */
  lanUrls: string[];
}

export function probePort(port: number, host = "127.0.0.1", timeoutMs = 700): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect({ port, host });
    const done = (ok: boolean) => { s.destroy(); resolve(ok); };
    s.setTimeout(timeoutMs, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

export async function addonStatus(lan: string[], extraPorts: number[] = [], probe = probePort, secure: { host: string; doors: Record<string, number> } | null = null): Promise<AddonStatus[]> {
  const defs: AddonDef[] = [...ADDONS];
  for (const port of extraPorts) {
    if (!Number.isInteger(port) || port < 1 || port > 65535 || defs.some((d) => d.port === port)) continue;
    defs.push({ id: `custom-${port}`, name: `Web page on port ${port}`, aircraft: "Added by you", port, path: "/", help: "Something you added by port number." });
  }
  return Promise.all(defs.map(async (d) => ({
    ...d,
    up: await probe(d.port),
    secureUrl: secure && secure.doors[d.id] ? `https://${secure.host}:${secure.doors[d.id]}${d.path}` : null,
    localUrl: `http://localhost:${d.port}${d.path}`,
    lanUrls: lan.map((ip) => `http://${ip}:${d.port}${d.path}`),
  })));
}
