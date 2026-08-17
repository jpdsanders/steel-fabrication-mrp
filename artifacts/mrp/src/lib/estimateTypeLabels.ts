export const ESTIMATE_TYPES = {
  preliminary: 'Preliminary',
  detailed: 'Detailed',
} as const;

export type EstimateTypeKey = keyof typeof ESTIMATE_TYPES;

export function getEstimateTypeLabel(type: EstimateTypeKey | string): string {
  // OPEN QUESTION: user-facing names for estimate types are not final — see OPEN_QUESTIONS.md (#2). 
  // All display labels MUST route through this constant.
  if (type in ESTIMATE_TYPES) {
    return ESTIMATE_TYPES[type as EstimateTypeKey];
  }
  // Fallback for unexpected values
  return type.charAt(0).toUpperCase() + type.slice(1);
}
