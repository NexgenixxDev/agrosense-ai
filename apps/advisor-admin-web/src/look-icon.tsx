import {
  AlertCircle,
  Camera,
  CheckCircle2,
  CloudOff,
  HeartPulse,
  HelpCircle,
  ImageOff,
  Search,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { LookIconName } from "./shared";

const ICONS = {
  check: CheckCircle2,
  care: HeartPulse,
  unsure: HelpCircle,
  camera: Camera,
  none: ImageOff,
  search: Search,
  error: AlertCircle,
  offline: CloudOff,
};

// The result icon for an AI outcome, coloured by its tone (see .ink-* in style.css).
export function LookIcon({
  name,
  tone,
  size = 18,
}: {
  name: LookIconName;
  tone: string;
  size?: number;
}) {
  const Icon = ICONS[name];
  return <Icon className={"ink-" + tone} size={size} strokeWidth={2.4} />;
}

// A case's own photo as a small thumbnail (images need the session token, so
// they're fetched as blobs); falls back to the result icon.
export function CaseThumb({
  caseId,
  imageId,
  token,
  icon,
  tone,
}: {
  caseId: string;
  imageId?: string | null;
  token: string;
  icon: LookIconName;
  tone: string;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!imageId) return;
    let cancelled = false;
    let made = "";
    fetch(`/api/cases/${caseId}/images/${imageId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((b) => {
        made = URL.createObjectURL(b);
        if (cancelled) URL.revokeObjectURL(made);
        else setUrl(made);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [caseId, imageId, token]);
  return url ? (
    <img className="case-thumb" src={url} alt="" />
  ) : (
    <span className={"emoji-bubble tone-" + tone}>
      <LookIcon name={icon} tone={tone} size={22} />
    </span>
  );
}
