export const EVENT_TYPES = [
  { value: "N", label: "National Events" },
  { value: "D1", label: "Division 1" },
  { value: "D2", label: "Division 2" },
  { value: "D3", label: "Division 3" },
  { value: "D4", label: "Division 4" },
  { value: "D5", label: "Division 5" },
  { value: "D6", label: "Division 6" },
  { value: "D7", label: "Division 7" },
];

export const SEASONS = Array.from({ length: 18 }, (_, i) => (2026 - i).toString());

export interface NhraEvent {
  eventType: string;
  startDate: string;
  eventCode: string;
  season: string;
  displayName: string;
}

export interface EventDate {
  value: string;
  label: string;
}
