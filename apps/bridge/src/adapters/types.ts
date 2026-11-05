import type { EventEmitter } from "node:events";
import type { AircraftInfo, SimConnectionState, SimulatorInfo, TelemetryFrame } from "@glidepath/protocol";

/** A frame as produced by an adapter: the session assigns the sequence number. */
export type RawFrame = Omit<TelemetryFrame, "seq">;

export interface AdapterEvents {
  state: (state: SimConnectionState, message: string | null) => void;
  simulator: (info: SimulatorInfo) => void;
  aircraft: (info: AircraftInfo) => void;
  frame: (frame: RawFrame) => void;
  /** The sim (or replay) ended the current session, e.g. returned to the main menu. */
  sessionEnd: () => void;
}

export interface SimAdapter extends EventEmitter {
  readonly id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  on<E extends keyof AdapterEvents>(event: E, listener: AdapterEvents[E]): this;
  emit<E extends keyof AdapterEvents>(event: E, ...args: Parameters<AdapterEvents[E]>): boolean;
}
