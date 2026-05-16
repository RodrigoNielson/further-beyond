const { DiceRoll } = require("@dice-roller/rpg-dice-roller/lib/umd/bundle.js");

function buildPredeterminedNotation(expression) {
  const diceRoll = new DiceRoll(expression);
  const notation = String(diceRoll.notation || expression || "").trim();
  const diceValues = [];

  for (const rollTerm of Array.isArray(diceRoll.rolls) ? diceRoll.rolls : []) {
    if (!rollTerm || typeof rollTerm !== "object") {
      continue;
    }

    const termResults = Array.isArray(rollTerm.rolls) ? rollTerm.rolls : [];
    termResults.forEach((result) => {
      const value = Number.parseInt(
        String(result?.value ?? result?.calculationValue ?? 0),
        10
      );

      if (Number.isFinite(value) && value > 0) {
        diceValues.push(value);
      }
    });
  }

  return {
    expression,
    notation,
    total: diceRoll.total,
    predetermined: diceValues.length ? `${notation}@${diceValues.join(",")}` : null,
  };
}

const expressions = process.argv.slice(2);
const cases = expressions.length ? expressions : ["d20", "2d6+3", "1d8+4"];

console.log(JSON.stringify(cases.map(buildPredeterminedNotation), null, 2));