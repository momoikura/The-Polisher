/**
 * Muse Spark does all the work in the loop. When CodePolish's revisions keep getting rejected and
 * the fix still isn't proven, one revision goes to a stronger model, then it's back to Muse Spark.
 * Its revision goes through the same gate as any other, so it's only kept if it makes things better.
 */

export const MAX_RESCUES = 2;

export function createRescue(input: {
  model: string;
  /** Enough budget left for a call to the stronger model. */
  hasRoom: () => boolean;
  isProven: () => boolean;
  onUse: (model: string) => void;
  maxUses?: number;
}): { markStuck: () => void; modelForRepair: () => string | undefined } {
  let stuck = false;
  let left = input.maxUses ?? MAX_RESCUES;
  return {
    markStuck: () => {
      stuck = true;
    },
    modelForRepair: () => {
      if (!stuck || left === 0 || input.isProven() || !input.hasRoom()) return undefined;
      stuck = false;
      left -= 1;
      input.onUse(input.model);
      return input.model;
    },
  };
}
