/**
 * Live camera: the simulator PC shares its screen (or just the sim window)
 * and any device on the same network watches it. Video goes device to device
 * with WebRTC; the Bridge only relays the setup messages. Nothing leaves your
 * network.
 */
import { useEffect, useRef, useState } from "react";
import type { BridgeClient } from "../data/bridge";

type Msg = { kind: string; from?: string; live?: boolean; data?: unknown };
type Sig = { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

const RTC_CONFIG: RTCConfiguration = { iceServers: [] };

/** True when this browser can share its screen (desktop browsers). */
export const canShare = () => typeof navigator !== "undefined" && !!navigator.mediaDevices && "getDisplayMedia" in navigator.mediaDevices && !/iPad|iPhone|Android/i.test(navigator.userAgent);

export function useCameraHost(b: BridgeClient | null) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [viewers, setViewers] = useState(0);
  const peers = useRef(new Map<string, RTCPeerConnection>());
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!b) return;
    const onMsg = async (m: Msg) => {
      const s = streamRef.current;
      if (!s) return;
      if (m.kind === "watch" && m.from) {
        peers.current.get(m.from)?.close();
        const pc = new RTCPeerConnection(RTC_CONFIG);
        peers.current.set(m.from, pc);
        setViewers(peers.current.size);
        s.getTracks().forEach((t) => pc.addTrack(t, s));
        pc.onicecandidate = (e) => { if (e.candidate) b.rtc("signal", m.from, { candidate: e.candidate.toJSON() }); };
        pc.onconnectionstatechange = () => { if (pc.connectionState === "failed" || pc.connectionState === "closed") { peers.current.delete(m.from!); setViewers(peers.current.size); } };
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        b.rtc("signal", m.from, { sdp: pc.localDescription!.toJSON() });
      } else if (m.kind === "signal" && m.from) {
        const pc = peers.current.get(m.from);
        const d = m.data as Sig;
        if (!pc) return;
        if (d.sdp) await pc.setRemoteDescription(d.sdp);
        else if (d.candidate) await pc.addIceCandidate(d.candidate).catch(() => undefined);
      } else if (m.kind === "leave" && m.from) {
        peers.current.get(m.from)?.close();
        peers.current.delete(m.from);
        setViewers(peers.current.size);
      }
    };
    b.rtcListeners.add(onMsg);
    return () => { b.rtcListeners.delete(onMsg); };
  }, [b]);

  const start = async () => {
    if (!b) return;
    const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 } }, audio: false });
    streamRef.current = s;
    setStream(s);
    s.getVideoTracks()[0]?.addEventListener("ended", () => stop());
    b.rtc("host-on");
  };
  const stop = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
    peers.current.forEach((pc) => pc.close());
    peers.current.clear();
    setViewers(0);
    b?.rtc("host-off");
  };
  useEffect(() => () => { if (streamRef.current) stop(); }, []);
  return { stream, viewers, start, stop };
}

export function CameraViewer({ b, onState }: { b: BridgeClient | null; onState?: (s: "off" | "connecting" | "live") => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [live, setLive] = useState(b?.cameraLive ?? false);
  const [state, setState] = useState<"off" | "connecting" | "live">("off");
  const pcRef = useRef<RTCPeerConnection | null>(null);
  useEffect(() => { onState?.(state); }, [state]);

  useEffect(() => {
    if (!b) return;
    const close = () => { pcRef.current?.close(); pcRef.current = null; };
    const watch = () => { close(); setState("connecting"); b.rtc("watch"); };
    const onMsg = async (m: Msg) => {
      if (m.kind === "host-state") {
        setLive(!!m.live);
        if (m.live) watch(); else { close(); setState("off"); }
        return;
      }
      if (m.kind !== "signal") return;
      const d = m.data as Sig;
      if (d.sdp && d.sdp.type === "offer") {
        close();
        const pc = new RTCPeerConnection(RTC_CONFIG);
        pcRef.current = pc;
        pc.ontrack = (e) => { if (video.current) { video.current.srcObject = e.streams[0] ?? new MediaStream([e.track]); void video.current.play().catch(() => undefined); } setState("live"); };
        pc.onicecandidate = (e) => { if (e.candidate) b.rtc("signal", undefined, { candidate: e.candidate.toJSON() }); };
        pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") setState("off"); };
        await pc.setRemoteDescription(d.sdp);
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        b.rtc("signal", undefined, { sdp: pc.localDescription!.toJSON() });
      } else if (d.candidate && pcRef.current) {
        await pcRef.current.addIceCandidate(d.candidate).catch(() => undefined);
      }
    };
    b.rtcListeners.add(onMsg);
    if (b.cameraLive) watch();
    return () => { b.rtcListeners.delete(onMsg); b.rtc("leave"); close(); };
  }, [b]);

  return (
    <div className="cam-view">
      <video ref={video} playsInline muted autoPlay className={state === "live" ? "on" : ""} />
      {state !== "live" && (
        <div className="cam-empty">
          {!b ? "Connect to your PC to watch the sim." : !live ? <>Nothing shared yet.<br /><span className="faint">On your sim PC, open Glidepath and press <b>Share my sim screen</b> on this page.</span></> : "Connecting to your PC…"}
        </div>
      )}
      {state === "live" && <span className="cam-live"><i />LIVE</span>}
    </div>
  );
}

/** On the sharing PC: show what is being shared, without a network round trip. */
export function LocalPreview({ stream }: { stream: MediaStream }) {
  const v = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (v.current) { v.current.srcObject = stream; void v.current.play().catch(() => undefined); } }, [stream]);
  return (
    <div className="cam-view">
      <video ref={v} playsInline muted autoPlay className="on" />
      <span className="cam-live"><i />SHARING</span>
    </div>
  );
}
