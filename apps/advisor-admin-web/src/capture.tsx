import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Camera,
  Image as ImageIcon,
  RefreshCw,
  Sprout,
} from "lucide-react";
import { statusText } from "./shared";

type Row = Record<string, any>;
type Stage = "pick" | "ready" | "sending" | "waiting" | "done";
const TOKEN_KEY = "agrosense-farmer-token";

const stored = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
};

// crypto.randomUUID only exists on HTTPS pages; the phone opens this over plain
// HTTP on the local network, so build a v4 UUID from getRandomValues instead.
function uuid() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// iPhones save HEIC, which the API rejects. Drawing the photo onto a canvas turns
// it into a JPEG of at most 1600 px (upright, as the browser applies orientation).
function toJpeg(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas
        .getContext("2d")!
        .drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (b) =>
          b ? resolve(b) : reject(new Error("Could not read the photo.")),
        "image/jpeg",
        0.85,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This file is not a photo the browser can open."));
    };
    img.src = url;
  });
}

export function Capture() {
  const [token, setToken] = useState(stored);
  const [stage, setStage] = useState<Stage>("pick");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState("");
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState<Row | null>(null);
  const [error, setError] = useState("");

  async function api(path: string, body?: unknown, image?: Blob) {
    const send = (auth: string) =>
      fetch("/api" + path, {
        method: body === undefined && !image ? "GET" : "POST",
        headers: {
          "Content-Type": image ? "image/jpeg" : "application/json",
          ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
        },
        body: image ?? (body === undefined ? undefined : JSON.stringify(body)),
      });
    let auth = token || (await signIn());
    let r = await send(auth);
    if (r.status === 401) {
      // The 8-hour demo session ran out: sign in again once.
      auth = await signIn();
      r = await send(auth);
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.message || "Something went wrong.");
    return data;
  }

  async function signIn() {
    const r = await fetch("/api/auth/dev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: "farmer-demo" }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.message || "Could not sign in.");
    try {
      sessionStorage.setItem(TOKEN_KEY, data.token);
    } catch {}
    setToken(data.token);
    return data.token as string;
  }

  useEffect(
    () => () => void (preview && URL.revokeObjectURL(preview)),
    [preview],
  );

  async function choose(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    try {
      const jpeg = await toJpeg(file);
      setPhoto(jpeg);
      setPreview(URL.createObjectURL(jpeg));
      setStage("ready");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function watch(id: string) {
    setStage("waiting");
    // The AI usually answers within seconds; give up after about two minutes.
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const c = await api(`/cases/${id}`);
      if (
        c.processing_state === "completed" ||
        c.processing_state === "failed"
      ) {
        setResult(c);
        setStage("done");
        return;
      }
    }
    throw new Error("The AI is taking too long. Check the portal later.");
  }

  async function analyse() {
    if (!photo) return;
    setError("");
    setStage("sending");
    try {
      const c = await api("/cases", {
        client_submission_id: uuid(),
        crop: "unknown",
        field_id: null,
        symptoms: {
          parts: "",
          duration: "",
          insects: "",
          spread: "",
          water: "",
        },
        consent_version: "2026-09-29",
        training_consent: false,
      });
      await api(`/cases/${c.id}/images`, undefined, photo);
      await api(`/cases/${c.id}/analysis`, {});
      await watch(c.id);
    } catch (err) {
      setError((err as Error).message);
      setStage(result ? "done" : "ready");
    }
  }

  async function retry() {
    if (!result) return;
    setError("");
    try {
      await api(`/cases/${result.id}/retry`, {});
      await watch(result.id);
    } catch (err) {
      setError((err as Error).message);
      setStage("done");
    }
  }

  function again() {
    setPhoto(null);
    setPreview("");
    setResult(null);
    setConsent(false);
    setError("");
    setStage("pick");
  }

  const a = result?.analysis;
  return (
    <div className="capture">
      <header>
        <span className="brand-icon">
          <Sprout />
        </span>
        AgroSense<span className="ai">AI</span>
      </header>
      {stage === "pick" && (
        <>
          <h1>Check your crop</h1>
          <p className="lead">
            Take a clear close-up of the affected leaves in even light. The AI
            will name the plant, the problem and what to do.
          </p>
          <label className="primary big">
            <Camera size={22} /> Take a photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={choose}
              hidden
            />
          </label>
          <label className="secondary big">
            <ImageIcon size={20} /> Choose from Photos
            <input type="file" accept="image/*" onChange={choose} hidden />
          </label>
        </>
      )}
      {preview && <img className="shot" src={preview} alt="Your crop photo" />}
      {stage === "ready" && (
        <>
          <label className="consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I agree to send this photo to an online AI service (Google Gemini or
            Anthropic Claude) for analysis.
          </label>
          <button className="primary big" disabled={!consent} onClick={analyse}>
            Analyse my crop <ArrowRight size={20} />
          </button>
          <button className="text-button" onClick={again}>
            Use a different photo
          </button>
        </>
      )}
      {(stage === "sending" || stage === "waiting") && (
        <p className="working">
          <RefreshCw size={18} className="spin" />
          {stage === "sending"
            ? "Sending your photo…"
            : "The AI is looking at your photo…"}
        </p>
      )}
      {stage === "done" && result && (
        <section className="result-box">
          {a ? (
            <>
              {a.plant && <p className="plant">Plant: {a.plant}</p>}
              <span className="badge">
                {statusText[a.status] ?? a.status}
                {a.confidence && ` · ${a.confidence} confidence`}
              </span>
              {a.candidates.map((c: Row) => (
                <h2 key={c.condition}>{c.condition}</h2>
              ))}
              <p>{a.reason}</p>
              {!!a.next_steps?.length && (
                <>
                  <h4>Solutions</h4>
                  <ol>
                    {a.next_steps.map((s: string) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                </>
              )}
              <small>
                AI suggestion from one photo, not a verified diagnosis. Ask an
                extension officer before using any chemical treatment.
              </small>
            </>
          ) : (
            <>
              <p>The analysis could not finish.</p>
              <button className="primary big" onClick={retry}>
                Try again
              </button>
            </>
          )}
        </section>
      )}
      {stage === "done" && (
        <button className="secondary big" onClick={again}>
          <Camera size={20} /> Check another crop
        </button>
      )}
      {error && (
        <div role="alert" className="notice">
          <AlertCircle size={18} /> {error}
        </div>
      )}
      <footer>Development demo · results also appear in the portal</footer>
    </div>
  );
}
