"use strict";

const { DiceRoller } = require("@dice-roller/rpg-dice-roller");

const DEFAULT_ROLLS = 100000;

function parseRollCount(value) {
    if (!value) {
        return DEFAULT_ROLLS;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Roll count must be a positive integer. Received: ${value}`);
    }

    return parsed;
}

function buildDistribution(rollCount) {
    const roller = new DiceRoller();
    const counts = Array.from({ length: 20 }, () => 0);

    for (let index = 0; index < rollCount; index += 1) {
        const roll = roller.roll("1d20");
        counts[roll.total - 1] += 1;
    }

    return counts.map((count, index) => ({
        result: index + 1,
        count,
        percentage: (count / rollCount) * 100,
    }));
}

function printDistribution(distribution, rollCount) {
    console.log(`Rolled ${rollCount} d20s using @dice-roller/rpg-dice-roller`);
    console.log("result,count,percentage");

    for (const entry of distribution) {
        console.log(
            `${entry.result},${entry.count},${entry.percentage.toFixed(4)}`
        );
    }
}

function main() {
    const rollCount = parseRollCount(process.argv[2]);
    const distribution = buildDistribution(rollCount);
    printDistribution(distribution, rollCount);
}

main();