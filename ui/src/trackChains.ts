import catalogue from "./data/trackChains.json";
export interface TrackChain {
  id: string; category: string; name: string; description: string;
  plugins: { type: string; name: string; setting: string; values: Record<string, number> }[];
}
export const TRACK_CHAINS = catalogue as unknown as TrackChain[];
export const CHAIN_CATEGORIES = [...new Set(TRACK_CHAINS.map((c) => c.category))];
