// Wording for AI result statuses, shared by the portal and the phone capture page.
export const statusText: Record<string, string> = {
  accepted: "Condition identified",
  uncertain: "Uncertain — check in person",
  retake: "Photo unclear — retake needed",
  unsupported: "No crop plant in the photo",
  unavailable: "AI analysis not configured",
};
