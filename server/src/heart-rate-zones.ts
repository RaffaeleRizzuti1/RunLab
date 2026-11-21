export const heartRateZoneKeys = ['z1', 'z2', 'z3', 'z4', 'z5'] as const;

type HeartRateZone = typeof heartRateZoneKeys[number];

export type HeartRateZones = {
  seconds: Record<HeartRateZone, number | null>;
  coverage: {
    activitiesWithZoneData: number;
    activitiesWithCompleteZoneData: number;
  };
};
