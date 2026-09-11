// Training-video library taxonomy — shared by the upload form, the console
// library, and the portal view so the filters and options always line up.

export const TRAINING_CATEGORIES = [
  "Dinking",
  "Serve & Return",
  "Third Shot Drop",
  "Drives",
  "Volleys & Blocks",
  "Resets",
  "Transition Zone",
  "Strategy & Positioning",
  "Footwork",
  "Serving Rules & Scoring",
  "Conditioning & Warm-up",
  "Match Play",
  "Other",
] as const;

export const TRAINING_SKILL_LEVELS = [
  "All levels",
  "Beginner (2.0–3.0)",
  "Intermediate (3.0–4.0)",
  "Advanced (4.0–5.0)",
  "Pro (5.0+)",
] as const;

export type TrainingVideoRow = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  skillLevel: string | null;
  videoUrl: string;
  visibleToPlayers: boolean;
  createdAt: Date;
};
