export const ANIMALS = [
  { id: 'leo', emoji: '🦁', name: 'Leo the Lion', blurb: 'The main mane event. Proud, loud and sure the whole river is watching his bottom.' },
  { id: 'zeke', emoji: '🦓', name: 'Zeke the Zebra', blurb: 'Stripes from nose to tail and not a single worry. Every toot comes in black and white.' },
  { id: 'gerry', emoji: '🦒', name: 'Gerry the Giraffe', blurb: 'Sees every rock coming from way up high, then toots from way down low.' },
  { id: 'hattie', emoji: '🦛', name: 'Hattie the Hippo', blurb: 'Built for heavy blasts. When Hattie toots, the whole river takes notice.' },
  { id: 'milo', emoji: '🐭', name: 'Milo the Mouse Lemur', blurb: 'Pocket-sized with saucer eyes. The toots are not pocket-sized.' },
  { id: 'ringo', emoji: '🐒', name: 'King Ringo XIII', blurb: 'Crowned himself ruler of the ringtail. Every toot is a royal decree.' },
];

export const ANIMAL_IDS = ANIMALS.map((a) => a.id);

export function animalById(id) {
  return ANIMALS.find((a) => a.id === id) ?? ANIMALS[0];
}
