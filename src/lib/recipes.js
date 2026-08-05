// Recipe-version resolution. Recipes are versioned: editing creates a new
// version, and reconciliation for a past day MUST use the version that was
// effective on that day, so historical waste reports never change retroactively.
import prisma from './prisma.js';

/**
 * For a given date, return Map<dishId, lines[]> using the RecipeVersion
 * effective on that date (latest effectiveFrom <= date; if the date predates
 * the first version, the earliest version is used).
 */
export async function getEffectiveRecipeLines(date) {
  const when = new Date(date);
  const recipes = await prisma.recipe.findMany({
    include: {
      versions: {
        orderBy: { effectiveFrom: 'asc' },
        include: { lines: { include: { item: true } } },
      },
    },
  });

  const map = new Map();
  for (const recipe of recipes) {
    if (!recipe.versions.length) continue;
    let chosen = recipe.versions[0];
    for (const v of recipe.versions) {
      if (new Date(v.effectiveFrom) <= when) chosen = v;
    }
    map.set(
      recipe.dishId,
      chosen.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitNote: l.unitNote, item: l.item })),
    );
  }
  return map;
}

export default getEffectiveRecipeLines;
