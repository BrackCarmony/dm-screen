import test from 'node:test';
import assert from 'node:assert/strict';
import { expandSpecial } from '../client/src/rules.js';

test('passive Perception is spelled out for display, and nothing else changes', () => {
  assert.equal(expandSpecial('Keen Sight and Smell. Darkvision 60 ft., PP 13'), 'Keen Sight and Smell. Darkvision 60 ft., Passive Perception 13');
  assert.equal(expandSpecial('Mgc Resis, dark 60 pperp 17 Sv'), 'Mgc Resis, dark 60 Passive Perception 17 Sv');
  // Only the abbreviation next to a number: words containing "pp" and a lone "PP" are left alone.
  assert.equal(expandSpecial('Ripples app 3. PP? Upper 12'), 'Ripples app 3. PP? Upper 12');
  assert.equal(expandSpecial(undefined), '');
});
