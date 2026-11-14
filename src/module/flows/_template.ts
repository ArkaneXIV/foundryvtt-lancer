// Import TypeScript modules
import type { LancerToken } from "../token";

type Point = { x: number; y: number };

/** Number of points sampled around a token's edge when testing gridless overlap */
const GRIDLESS_EDGE_SAMPLES = 24;

/**
 * Tolerance in pixels for points on the region boundary. Grid-based shapes pass exactly through the
 * centers of their outermost spaces; core uses the same tolerance for highlighting and token containment.
 */
const BOUNDARY_TOLERANCE = 0.75;

/**
 * Sets user targets to tokens that are within the area of an attack template.
 *
 * In Foundry v14 attack templates are Regions (MeasuredTemplates were folded
 * into Regions and share their ids), so this accepts either id.
 * @param templateId - The id of the template Region to use
 */
export function targetsFromTemplate(templateId: string): void {
  if (!canvas?.ready || !canvas.scene || !canvas.grid) return;
  const region = canvas.scene.regions.get(templateId) as RegionDocument.Implementation | undefined;
  if (!region) return;

  const RegionClass = region.constructor as any;
  const testPoint = (point: Point, elevation: number) =>
    RegionClass._testElevation(region.elevation, elevation) &&
    (region as any).polygonTree.testPoint(point, BOUNDARY_TOLERANCE);
  // Respect scene levels: only tokens on a level the region is included in can be hit
  const inLevel = (token: LancerToken) => {
    const level = (token.document as any).level;
    return typeof (region as any).includedInLevel !== "function" || (region as any).includedInLevel(level);
  };

  let test_token: (t: LancerToken) => boolean;
  if (canvas.grid.isGridless) {
    // Hit if the token's circular footprint overlaps the region
    test_token = (token: LancerToken) => {
      const elevation = token.document.elevation;
      const center = token.center;
      if (testPoint(center, elevation)) return true;
      const radius = ((token.document.width ?? 1) / 2) * canvas.dimensions!.size * 0.999;
      for (let i = 0; i < GRIDLESS_EDGE_SAMPLES; i++) {
        const theta = (2 * Math.PI * i) / GRIDLESS_EDGE_SAMPLES;
        const p = { x: center.x + radius * Math.cos(theta), y: center.y + radius * Math.sin(theta) };
        if (testPoint(p, elevation)) return true;
      }
      return false;
    };
  } else {
    // Hit if any grid space occupied by the token has its center inside the region
    test_token = (token: LancerToken) => {
      const elevation = token.document.elevation;
      return token.document
        .getOccupiedGridSpaceOffsets()
        .some(offset => testPoint(canvas.grid!.getCenterPoint(offset), elevation));
    };
  }

  // Get list of tokens and dispositions to ignore.
  const ignore = region.getFlag(game.system.id as "lancer", "ignore") as
    | { tokens: string[]; dispositions: number[] }
    | undefined;

  // Test if each token occupies a targeted space and target it if true
  const targets = (canvas.tokens!.placeables as unknown as LancerToken[])
    .filter(t => {
      const skip = (ignore?.tokens.includes(t.id) || ignore?.dispositions.includes(t.document.disposition)) ?? false;
      return !skip && t.isVisible && inLevel(t) && test_token(t);
    })
    .map(t => t.id);
  canvas.tokens!.setTargets(targets);
}
