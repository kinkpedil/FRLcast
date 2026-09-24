// The shape of a recap. This mirrors what FRLcast already holds: an event header plus a
// classification of drivers. In production this would be filled from a hosted event (the
// results table + standings) or from the local server's state; here it is sample data so the
// PoC renders on its own.

export type Driver = {
  pos: number;
  num: string;
  name: string;
  team?: string;
  color: string;
  points?: number;
  best?: string; // best lap, already formatted (m:ss.mmm)
};

export type RecapData = {
  event: string;
  round: string;
  track: string;
  drivers: Driver[]; // sorted by finishing position
};

export const SAMPLE: RecapData = {
  event: 'Winter Drift Cup',
  round: 'Round 3 of 5',
  track: 'Ebisu Minami',
  drivers: [
    { pos: 1, num: '7', name: 'Aiko Tanaka', team: 'Team Kaido', color: '#ff5c7a', points: 25, best: '1:31.850' },
    { pos: 2, num: '23', name: 'Bruno Silva', team: 'Sao Drift', color: '#38d996', points: 18, best: '1:32.104' },
    { pos: 3, num: '4', name: 'Caio Souza', team: 'Sao Drift', color: '#4aa3ff', points: 15, best: '1:32.560' },
    { pos: 4, num: '9', name: 'Deni Putra', team: 'SPFF', color: '#ffd60a', points: 12, best: '1:32.988' },
    { pos: 5, num: '12', name: 'Mavin Lee', team: 'Night Owls', color: '#bf5af2', points: 10, best: '1:33.201' },
    { pos: 6, num: '3', name: 'Rizky Halim', team: 'SPFF', color: '#ff9f0a', points: 8, best: '1:33.640' },
  ],
};
