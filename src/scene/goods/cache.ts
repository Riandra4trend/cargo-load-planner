import { useLayoutEffect } from 'react';
import { MeshStandardMaterial } from 'three';
import type { ItemSpec } from '../../domain/types';
import { buildGoodsModel, disposeGoodsModel, goodsKey, type GoodsModel } from './model';

/**
 * Goods models shared by every unit of the same spec. Models are created lazily on first use and
 * reference-counted by mounted components (`useRetainGoods`); unused models are disposed.
 */
const cache = new Map<string, { model: GoodsModel; refs: number }>();

export function goodsModelFor(spec: ItemSpec): GoodsModel {
  const key = goodsKey(spec);
  let entry = cache.get(key);
  if (!entry) {
    entry = { model: buildGoodsModel(spec), refs: 0 };
    cache.set(key, entry);
  }
  return entry.model;
}

function release(keys: readonly string[]): void {
  for (const key of keys) {
    const entry = cache.get(key);
    if (entry) entry.refs--;
  }
  // Deferred so an unmount/remount (Strict Mode, list reorders) does not rebuild the geometry.
  setTimeout(() => {
    for (const key of keys) {
      const entry = cache.get(key);
      if (entry && entry.refs <= 0) {
        disposeGoodsModel(entry.model);
        cache.delete(key);
      }
    }
  }, 0);
}

/** Keeps the given models alive while the calling component is mounted. */
export function useRetainGoods(keys: readonly string[]): void {
  const joined = keys.join('\n');
  useLayoutEffect(() => {
    const list = joined ? joined.split('\n') : [];
    for (const key of list) {
      const entry = cache.get(key);
      if (entry) entry.refs++;
    }
    return () => release(list);
  }, [joined]);
}

/** Realistic goods: vertex-coloured parts. */
export const GOODS_SOLID = new MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.04 });
/** Colour-mode tags: white, tinted by the per-instance colour. */
export const GOODS_TAG = new MeshStandardMaterial({ roughness: 0.5, metalness: 0.02 });
/** Stretch film around palletized goods. */
export const GOODS_FILM = new MeshStandardMaterial({ color: '#eef4f9', transparent: true, opacity: 0.24, roughness: 0.15, metalness: 0, depthWrite: false });
