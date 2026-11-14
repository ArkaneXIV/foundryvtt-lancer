/**
 * Placeable attack templates for Blast, Burst, Cone, and Line weapons.
 *
 * In Foundry v14 MeasuredTemplates were folded into Regions, so these templates
 * are placed with `canvas.regions.placeRegion` and stored as Region documents.
 */

import { RangeType } from "../enums";
import type { RangeData } from "../models/bits/range";

/**
 * Helper to create and place a Region-based attack template from a weapon range
 * @example
 * ```javascript
 * const template = WeaponRangeTemplate.fromRange({
 *   type: "Cone",
 *   val: "5",
 * });
 * template?.placeTemplate()
 *   .catch(() => {}) // Handle canceled
 *   .then(t => {
 *     if (t) {
 *       // t is a RegionDocument with flag data
 *     }
 * });
 * ```
 */
export class WeaponRangeTemplate {
  /** Unsaved Region document holding the template data. Can be modified before placement. */
  document: RegionDocument.Implementation;

  private actorSheet: { minimize(): unknown; maximize(): unknown } | undefined;

  private constructor(document: RegionDocument.Implementation) {
    this.document = document;
  }

  get range(): RangeData {
    return this.document.getFlag(game.system.id as "lancer", "range") as RangeData;
  }

  get isBurst() {
    return this.range.type === RangeType.Burst;
  }

  /**
   * Creates a new WeaponRangeTemplate from a provided range object
   * @param range      - Range data
   * @param range.type - Type of template. A RangeType in typescript, or a string in js.
   * @param range.val  - Size of template. A numeric string
   * @param creator    - A token that is designated as the owner of the template.
   *                     Used to deterimine the character sheet to close as well
   *                     as a default ignore target for Cones and Lines.
   */
  static fromRange({ type, val }: RangeData, creator?: Token.Implementation): WeaponRangeTemplate | null {
    if (!canvas.ready || !canvas.scene) return null;
    const dist = Number(val);
    if (isNaN(dist)) return null;
    const square: boolean = canvas.grid!.isSquare;
    const gridDistance = canvas.dimensions!.distance;
    const distancePixels = canvas.dimensions!.distancePixels;
    // core.gridTemplates is deprecated in v14; follow the core template-mode configuration instead
    const gridBased = (CONFIG.Region as any).templateModeConfig?.gridBased === true;

    let shape: Record<string, unknown>;
    switch (type) {
      case RangeType.Cone:
        shape = {
          type: "cone",
          x: 0,
          y: 0,
          radius: dist * gridDistance * distancePixels,
          angle: square ? 51 : 59,
          rotation: 0,
          curvature: "round",
          gridBased,
        };
        break;
      case RangeType.Line:
        shape = {
          type: "line",
          x: 0,
          y: 0,
          length: dist * gridDistance * distancePixels,
          width: gridDistance * distancePixels,
          rotation: 0,
          gridBased,
        };
        break;
      case RangeType.Burst:
      case RangeType.Blast:
        shape = { type: "circle", x: 0, y: 0, radius: dist * gridDistance * distancePixels, gridBased };
        break;
      default:
        return null;
    }

    const regionData = {
      name: `${type} ${dist}`,
      color: game.user!.color.css,
      shapes: [shape],
      elevation: { bottom: null, top: null },
      levels: (canvas as any).level ? [(canvas as any).level.id] : [],
      visibility: CONST.REGION_VISIBILITY.ALWAYS,
      highlightMode: "coverage",
      displayMeasurements: true,
      ownership: {
        default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
        [game.user!.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
      },
      flags: {
        [game.system.id]: {
          range: { type, val: dist },
          creator: creator?.id,
          ignore: {
            tokens: [RangeType.Blast, RangeType.Burst].includes(type) || !creator ? [] : [creator.id],
            dispositions: <TokenDocument.Implementation["disposition"][]>[],
          },
        },
      },
    };

    const cls = CONFIG.Region.documentClass as any;
    const document = new cls(regionData, { parent: canvas.scene });
    const template = new this(document);
    template.actorSheet = creator?.actor?.sheet ?? undefined;
    return template;
  }

  /** The id of the placed Region, if any */
  get id(): string | null {
    return this.document.id;
  }

  /**
   * Start placement of the template. Returns immediately, so cannot be used to
   * block until a template is placed.
   * @deprecated Since 1.0
   */
  drawPreview(): void {
    console.warn("WeaponRangeTemplate.drawPreview() is deprecated and has been replaced by placeTemplate()");
    this.placeTemplate().catch(() => {});
  }

  /**
   * Start placement of the template. Left-click places it, right-click or
   * Escape cancels, and the mouse wheel rotates Cones and Lines.
   * @returns A Promise that resolves to the created RegionDocument or
   * rejects when creation is canceled or fails.
   */
  async placeTemplate(): Promise<RegionDocument.Implementation> {
    if (!canvas.ready) {
      ui.notifications?.error("Cannot create WeaponRangeTemplate. Canvas is not ready");
      throw new Error("Cannot create WeaponRangeTemplate. Canvas is not ready");
    }
    const initialLayer = canvas.activeLayer;
    this.actorSheet?.minimize();
    let burstToken: string | undefined;
    let region: RegionDocument.Implementation | null = null;
    try {
      region = await (canvas.regions as any).placeRegion(this.document.toObject(), {
        allowRotation: !this.isBurst && this.range.type !== RangeType.Blast,
        onMove: ({ shape, position }: { shape: any; position: { x: number; y: number } }) => {
          if (this.isBurst) {
            const { center, radius, tokenId } = this.snapToToken(position);
            burstToken = tokenId;
            shape.updateSource({ x: center.x, y: center.y, radius });
          } else {
            shape.updateSource(this.snapToCenter(position));
          }
          return false;
        },
        preCommit: (documents: RegionDocument.Implementation[]) => {
          if (!burstToken) return;
          const ignore = foundry.utils.deepClone(
            documents[0].getFlag(game.system.id as "lancer", "ignore") as { tokens: string[] }
          );
          ignore.tokens.push(burstToken);
          documents[0].updateSource({
            [`flags.${game.system.id}.ignore.tokens`]: ignore.tokens,
            [`flags.${game.system.id}.burstToken`]: burstToken,
          });
        },
      });
    } finally {
      this.actorSheet?.maximize();
      (initialLayer as any)?.activate();
    }
    if (!region) throw new Error("Template creation cancelled");
    this.document = region;
    return region;
  }

  /**
   * Snapping function to only snap to the center of spaces rather than corners.
   */
  private snapToCenter({ x, y }: { x: number; y: number }): { x: number; y: number } {
    const snapped = canvas.grid!.getCenterPoint({ x, y });
    return { x: Math.round(snapped.x), y: Math.round(snapped.y) };
  }

  /**
   * Snapping function to snap to the center of a hovered token. Also computes
   * the burst radius from the token's size.
   */
  private snapToToken({ x, y }: { x: number; y: number }): {
    center: { x: number; y: number };
    radius: number;
    tokenId?: string;
  } {
    const token = canvas
      .tokens!.placeables.filter(t => {
        // test if cursor is inside token (placeable x/y are not canvas coordinates in v14, so use bounds)
        return t.bounds.contains(x, y);
      })
      .reduce((r: Token.Implementation | null, t) => {
        // skip hidden tokens
        if (!t.visible) return r;
        // use the token that is closest.
        if (
          r === null ||
          canvas.grid!.measurePath([{ x, y }, t.center], {}).distance <
            canvas.grid!.measurePath([{ x, y }, r.center], {}).distance
        )
          return t;
        else return r;
      }, null);
    if (token) {
      return {
        center: { x: Math.round(token.center.x), y: Math.round(token.center.y) },
        radius: this.getBurstDistance(token.document.width!) * canvas.dimensions!.distancePixels,
        tokenId: token.id ?? undefined,
      };
    }
    return {
      center: this.snapToCenter({ x, y }),
      radius: this.getBurstDistance(1) * canvas.dimensions!.distancePixels,
    };
  }

  /**
   * Get fine-tuned sizing data for Burst templates, in scene distance units
   */
  private getBurstDistance(size: number): number {
    return (this.range.val + size / 2) * canvas.dimensions!.distance;
  }
}

declare module "fvtt-types/configuration" {
  interface FlagConfig {
    Region: {
      lancer: {
        range: RangeData;
        creator?: string;
        burstToken?: string;
        ignore: { tokens: string[]; dispositions: TokenDocument.Implementation["disposition"][] };
        isAttack?: boolean;
      };
    };
  }
}
