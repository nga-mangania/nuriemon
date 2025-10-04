import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadImage } from '../services/imageStorage';
import { downscaleDataUrl } from '../utils/image';
import { getAllMovementSettings } from '../services/movementStorage';
import { useWorkspaceStore, WorkspaceImage } from '../stores/workspaceStore';

type AnimationInput = {
  id: string;
  originalFileName: string;
  imageUrl: string;
  type: 'walk' | 'fly';
  movement: string;
  size: string;
  speed: number;
  createdAt: number;
  displayStartedAt: string | null;
};

const ensureTimestamp = (value: string | undefined): number => {
  if (!value) return Date.now();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
};

export const useAnimationData = () => {
  const processedImages = useWorkspaceStore(state => state.processedImages);

  const processedImagesRef = useRef<WorkspaceImage[]>(processedImages);
  useEffect(() => {
    processedImagesRef.current = processedImages;
  }, [processedImages]);

  const cacheRef = (useAnimationData as any)._displayUrlCache as Map<string, string> | undefined;
  const displayUrlCache = cacheRef ?? new Map<string, string>();
  if (!cacheRef) {
    (useAnimationData as any)._displayUrlCache = displayUrlCache;
  }

  const animationMapRef = useRef<Map<string, AnimationInput>>(new Map());
  const [version, setVersion] = useState(0);
  const [newImageAdded, setNewImageAdded] = useState(false);
  const syncingRef = useRef(false);
  const initialSyncRef = useRef(true);
  const pendingSyncRef = useRef(false);

  const buildAnimationInput = useCallback(async (
    meta: WorkspaceImage,
    movementMap: Map<string, { type: string; movement: string; speed: number; size: string }>
  ): Promise<AnimationInput | null> => {
    try {
      let imageUrl = displayUrlCache.get(meta.id);
      if (!imageUrl) {
        const raw = await loadImage({ id: meta.id, savedFileName: meta.savedFileName, type: 'processed' } as any);
        imageUrl = await downscaleDataUrl(raw, 512, 0.8);
        displayUrlCache.set(meta.id, imageUrl);
      }

      const movement = movementMap.get(meta.id);
      const type: 'walk' | 'fly' = movement?.type === 'walk' ? 'walk' : 'fly';

      return {
        id: meta.id,
        originalFileName: meta.originalFileName,
        imageUrl,
        type,
        movement: movement?.movement ?? 'normal',
        size: movement?.size ?? 'medium',
        speed: typeof movement?.speed === 'number' ? movement.speed : 0.5,
        createdAt: ensureTimestamp(meta.createdAt),
        displayStartedAt: meta.displayStartedAt ?? null,
      };
    } catch (error) {
      console.error(`Error loading image ${meta.id}:`, error);
      return null;
    }
  }, [displayUrlCache]);

  const syncProcessedImages = useCallback(async (initialOverride?: boolean) => {
    if (syncingRef.current) {
      pendingSyncRef.current = true;
      return;
    }
    syncingRef.current = true;
    try {
      const metas = processedImagesRef.current;
      const map = animationMapRef.current;
      const incomingIds = new Set(metas.map(meta => meta.id));
      let changed = false;

      for (const id of Array.from(map.keys())) {
        if (!incomingIds.has(id)) {
          map.delete(id);
          changed = true;
        }
      }

      if (metas.length === 0) {
        if (changed) setVersion(v => v + 1);
        initialSyncRef.current = false;
        return;
      }

      const movementMap = await getAllMovementSettings();

      for (const meta of metas) {
        const existing = map.get(meta.id);
        if (existing) {
          const movement = movementMap.get(meta.id);
          existing.type = movement?.type === 'walk' ? 'walk' : 'fly';
          existing.movement = movement?.movement ?? 'normal';
          existing.size = movement?.size ?? 'medium';
          existing.speed = typeof movement?.speed === 'number' ? movement.speed : 0.5;
          existing.originalFileName = meta.originalFileName;
          existing.createdAt = ensureTimestamp(meta.createdAt);
          existing.displayStartedAt = meta.displayStartedAt ?? null;
        }
      }

      const newMetas = metas.filter(meta => !map.has(meta.id));
      let hasNew = false;
      if (newMetas.length > 0) {
        const built = await Promise.all(newMetas.map(meta => buildAnimationInput(meta, movementMap)));
        built.forEach((entry, idx) => {
          if (entry) {
            map.set(newMetas[idx].id, entry);
            changed = true;
            hasNew = true;
          }
        });
      }

      if (changed) {
        setVersion(v => v + 1);
      }

      const initial = initialOverride ?? initialSyncRef.current;
      if (initial) {
        initialSyncRef.current = false;
      } else if (hasNew) {
        setNewImageAdded(true);
      }
    } finally {
      syncingRef.current = false;
      if (pendingSyncRef.current) {
        pendingSyncRef.current = false;
        setTimeout(() => {
          syncProcessedImages();
        }, 0);
      }
    }
  }, [buildAnimationInput]);

  useEffect(() => {
    let frameId: number | undefined;
    const schedule = () => {
      if (frameId !== undefined) return;
      frameId = requestAnimationFrame(() => {
        frameId = undefined;
        syncProcessedImages();
      });
    };

    schedule();

    return () => {
      if (frameId !== undefined) {
        cancelAnimationFrame(frameId);
        frameId = undefined;
      }
    };
  }, [processedImages, syncProcessedImages]);

  const refresh = useCallback(async (options?: { initial?: boolean }) => {
    await syncProcessedImages(options?.initial);
  }, [syncProcessedImages]);

  const animatedImages = useMemo(() => {
    const arr = Array.from(animationMapRef.current.values());
    arr.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return arr;
  }, [version]);

  return {
    animatedImages,
    refresh,
    newImageAdded,
    setNewImageAdded,
  };
};
