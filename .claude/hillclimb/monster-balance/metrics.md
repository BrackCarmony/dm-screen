# Monster generator eval

Each case is one prompt from `evals/monster-cases.json`, run through `server/ai.js`'s generator.

- **Balanced**: of the case's monsters that `evals/balance.js` can judge, the share whose defense and offense each fit their CR (within 3 steps). Left out when none can be judged (spellcasters, legendary monsters, CR above 10).
- **Right count**: 1 if it made as many monsters as the prompt asked for (one when it doesn't say).
- **Asked-for CR**: when the prompt names one CR, the share of monsters at that CR.
- **Unsure**: the share of monsters the grader can't judge. Lower is better.

A refusal or an unreadable reply scores 0 on the first three.
