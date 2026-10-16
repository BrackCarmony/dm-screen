# Monster generator eval

Each case is one prompt from `evals/monster-cases.json`, run through `server/ai.js`'s generator.

- **Balanced**: of the case's monsters that `evals/balance.js` can judge, the share whose defense and offense each fit their CR (within 3 steps). Left out when none can be judged (spellcasters, legendary monsters, CR above 10).
- **Right count**: 1 if it made as many monsters as the prompt asked for (one when it doesn't say).
- **Asked-for CR**: when the prompt names one CR, the share of monsters at that CR.
- **Unsure**: the share of monsters the grader can't judge. Lower is better.

A refusal or an unreadable reply scores 0 on the first three.
- **Unique names**: the share of monsters a DM can tell apart by name: not numbered ("Frost Wolf (1)") and not repeated within the reply. Names from the franchise a request is based on are fine.
- **Varied stats**: of monsters at CR 10 or below, the share that don't sit on the typical row for their CR (HP within 5% and exactly its AC). Real SRD monsters at CR 1-10 sit on it 6% of the time; a model given the table can copy it.

Prompts tagged `lopsided` (a tank, a glass cannon, a brute that "can take a beating") pass on their averaged CR, within 2 steps, rather than defense and offense each within 3.
