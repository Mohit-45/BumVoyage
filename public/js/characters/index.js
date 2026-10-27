import { CharacterRig } from './rig.js';
import * as leo from './leo.js';
import * as zeke from './zeke.js';
import * as gerry from './gerry.js';
import * as hattie from './hattie.js';
import * as milo from './milo.js';
import * as ringo from './ringo.js';

export const CHARACTERS = { leo, zeke, gerry, hattie, milo, ringo };

export function buildAnimal(id) {
  const entry = CHARACTERS[id] ?? CHARACTERS.leo;
  return new CharacterRig(entry.spec, entry.build);
}
