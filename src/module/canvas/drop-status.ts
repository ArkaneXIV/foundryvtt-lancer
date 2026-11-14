import { LancerItem } from "../item/lancer-item";

export function dropStatusToCanvas(
  canvas: Canvas,
  data: { type: string; uuid: string; x: number; y: number }
): void | false {
  const type: string | undefined = fromUuidSync(data.uuid)?.type;
  if (data.type !== "Item" || type !== "status") return;
  const rect = new PIXI.Rectangle(data.x, data.y, 0, 0);
  const tokens: Set<Token.Implementation> = canvas.tokens!.quadtree!.getObjects(rect, {
    // Token placeables no longer carry canvas coordinates/hitArea in v14; test against their bounds
    collisionTest: o => o.t.bounds.contains(data.x, data.y),
  }) as any;
  if (tokens.size !== 1 || !tokens.first()?.actor?.isOwner) return;
  LancerItem.fromDropData(data as any).then(i => tokens.first()?.actor?.createEmbeddedDocuments("Item", [i! as any]));
  // If we get here, we've succeeded and don't want other handlers to run
  return false;
}
