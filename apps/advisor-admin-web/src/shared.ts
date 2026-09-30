// Wording for AI result statuses, shared by the portal and the phone capture page.
export const statusText: Record<string, string> = {
  accepted: "Condition identified",
  uncertain: "Uncertain — check in person",
  retake: "Photo unclear — retake needed",
  unsupported: "No plant found in the photo",
  unavailable: "AI analysis not configured",
};

type Analysis = Record<string, any> | null | undefined;

// Emoji, headline and colour tone for an AI outcome (matches the farmer app).
export function lookFor(a: Analysis, processing?: string) {
  if (!a)
    return processing === "failed"
      ? { emoji: "😕", headline: "Something went wrong", tone: "sunshine" }
      : { emoji: "🔍", headline: "Looking closely…", tone: "sky" };
  const condition = String(a.candidates?.[0]?.condition ?? "").toLowerCase();
  switch (a.status) {
    case "accepted":
      return condition.includes("healthy")
        ? { emoji: "🎉", headline: "Looks healthy!", tone: "mint" }
        : { emoji: "🩹", headline: "Needs some care", tone: "peach" };
    case "uncertain":
      return { emoji: "🤔", headline: "Hmm, not sure", tone: "sunshine" };
    case "retake":
      return { emoji: "📸", headline: "Try another photo", tone: "sky" };
    case "unsupported":
      return { emoji: "🔍", headline: "No plant found", tone: "lavender" };
    default:
      return { emoji: "😴", headline: "The AI is resting", tone: "lavender" };
  }
}

const EMOJI: [string, string][] = [
  ["tomato", "🍅"], ["maize", "🌽"], ["corn", "🌽"], ["mahangu", "🌾"],
  ["millet", "🌾"], ["sorghum", "🌾"], ["wheat", "🌾"], ["spinach", "🥬"],
  ["cabbage", "🥬"], ["lettuce", "🥬"], ["potato", "🥔"], ["pepper", "🌶️"],
  ["chilli", "🌶️"], ["bean", "🫘"], ["pumpkin", "🎃"], ["squash", "🎃"],
  ["carrot", "🥕"], ["onion", "🧅"], ["melon", "🍉"], ["rose", "🌹"],
  ["sunflower", "🌻"], ["cactus", "🌵"],
];

// A friendly emoji for the plant the AI named; a leaf for anything else.
export const plantEmoji = (plant?: string | null) =>
  EMOJI.find(([word]) => (plant ?? "").toLowerCase().includes(word))?.[1] ??
  "🌿";
