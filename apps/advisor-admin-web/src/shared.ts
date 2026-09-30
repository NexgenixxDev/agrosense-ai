// Wording for AI result statuses, shared by the portal and the phone capture page.
export const statusText: Record<string, string> = {
  accepted: "Condition identified",
  uncertain: "Uncertain — check in person",
  retake: "Photo unclear — retake needed",
  unsupported: "No plant found in the photo",
  unavailable: "AI analysis not configured",
};

type Analysis = Record<string, any> | null | undefined;

// Icon, headline and colour tone for an AI outcome (matches the farmer app).
export type LookIconName =
  | "check"
  | "care"
  | "unsure"
  | "camera"
  | "none"
  | "search"
  | "error"
  | "offline";

export function lookFor(a: Analysis, processing?: string) {
  const look = (icon: LookIconName, headline: string, tone: string) => ({
    icon,
    headline,
    tone,
  });
  if (!a)
    return processing === "failed"
      ? look("error", "Something went wrong", "sunshine")
      : look("search", "Looking closely…", "sky");
  const condition = String(a.candidates?.[0]?.condition ?? "").toLowerCase();
  switch (a.status) {
    case "accepted":
      return condition.includes("healthy")
        ? look("check", "Looks healthy!", "mint")
        : look("care", "Needs some care", "peach");
    case "uncertain":
      return look("unsure", "Not sure yet", "sunshine");
    case "retake":
      return look("camera", "Try another photo", "sky");
    case "unsupported":
      return look("none", "No plant found", "lavender");
    default:
      return look("offline", "The AI is resting", "lavender");
  }
}
