import { Entitlement, EntitlementQueueItem } from "./types";

/**
 * EntitlementManager
 * 
 * Quản lý toàn bộ logic liên quan đến Entitlement:
 * - Xác định entitlement hiện tại từ queue
 * - Kiểm tra quyền truy cập feature
 * - Thêm entitlement vào queue với logic cắt/chèn theo priority
 * - Cache entitlement config từ Firestore
 */

// Cache for entitlement configs (in-memory)
const ENTITLEMENT_CACHE: Record<string, Entitlement> = {};

export class EntitlementManager {
    /**
     * Lấy entitlement config từ Firestore (hoặc cache)
     */
    static async getEntitlementConfig(
        entitlementId: string,
        getEntitlementById: (id: string) => Promise<any | null>
    ): Promise<Entitlement | null> {
        // Check cache first
        if (ENTITLEMENT_CACHE[entitlementId]) {
            return ENTITLEMENT_CACHE[entitlementId];
        }

        try {
            const config = await getEntitlementById(entitlementId);
            if (config) {
                ENTITLEMENT_CACHE[entitlementId] = config;
            }
            return config;
        } catch (e) {
            console.error(`Failed to load entitlement config for ${entitlementId}:`, e);
            return null;
        }
    }

    /**
     * Resolve features với inheritance
     * Ví dụ: tier_pro inherit tier_basic inherit tier_free
     * => features = [...tier_free, ...tier_basic, ...tier_pro]
     */
    static async resolveFeatures(
        entitlementId: string,
        getEntitlementById: (id: string) => Promise<any | null>
    ): Promise<string[]> {
        const config = await this.getEntitlementConfig(entitlementId, getEntitlementById);
        if (!config) return [];

        let allFeatures = [...config.features];

        // Recursively resolve inherited features
        if (config.inherit) {
            const inheritedFeatures = await this.resolveFeatures(config.inherit, getEntitlementById);
            allFeatures = [...inheritedFeatures, ...allFeatures];
        }

        // Remove duplicates
        return Array.from(new Set(allFeatures));
    }

    /**
     * Xác định entitlement hiện tại từ queue
     * Logic: Tìm entitlement có start <= now < end
     */
    static getCurrentEntitlement(queue: EntitlementQueueItem[]): EntitlementQueueItem | null {
        if (!queue || queue.length === 0) return null;

        const now = Date.now();

        // Find active entitlement
        const active = queue.find(item => item.start <= now && now < item.end);
        return active || null;
    }

    /**
     * Kiểm tra quyền truy cập feature
     */
    static async hasFeature(
        queue: EntitlementQueueItem[],
        featureId: string,
        getEntitlementById: (id: string) => Promise<any | null>
    ): Promise<boolean> {
        const current = this.getCurrentEntitlement(queue);
        if (!current) {
            // No active entitlement, check tier_free
            const freeFeatures = await this.resolveFeatures("tier_free", getEntitlementById);
            return freeFeatures.includes(featureId);
        }

        const features = await this.resolveFeatures(current.id, getEntitlementById);
        return features.includes(featureId);
    }

    /**
     * Thêm entitlement vào queue với logic pause/resume theo priority
     * 
     * Logic MỚI (Pause instead of Cut):
     * 1. Lấy level của entitlement mới
     * 2. Tìm các entitlement trong queue có overlap về thời gian
     * 3. Nếu level mới > level cũ: 
     *    - Pause entitlement cũ (đóng băng thời gian còn lại)
     *    - Chèn entitlement mới vào vị trí hiện tại
     *    - Resume entitlement cũ sau khi entitlement mới hết hạn
     * 4. Nếu level mới <= level cũ: Lùi entitlement mới ra sau
     */
    static async addEntitlementToQueue(
        currentQueue: EntitlementQueueItem[],
        entitlementId: string,
        durationDays: number,
        getEntitlementById: (id: string) => Promise<any | null>
    ): Promise<EntitlementQueueItem[]> {
        const newConfig = await this.getEntitlementConfig(entitlementId, getEntitlementById);
        if (!newConfig) {
            throw new Error(`Entitlement ${entitlementId} not found`);
        }

        const now = Date.now();
        const newStart = now;
        const newEnd = now + durationDays * 24 * 60 * 60 * 1000;

        // Create new queue item
        const newItem: EntitlementQueueItem = {
            id: entitlementId,
            start: newStart,
            end: newEnd
        };

        // If queue is empty, just add it
        if (!currentQueue || currentQueue.length === 0) {
            return [newItem];
        }

        // Sort queue by start time
        const sortedQueue = [...currentQueue].sort((a, b) => a.start - b.start);

        // Find overlapping items
        const result: EntitlementQueueItem[] = [];
        let newItemInserted = false;

        for (const item of sortedQueue) {
            const itemConfig = await this.getEntitlementConfig(item.id, getEntitlementById);
            if (!itemConfig) continue;

            // Check if there's overlap
            const hasOverlap = !(newEnd <= item.start || newStart >= item.end);

            if (!hasOverlap) {
                // No overlap, keep the item as is
                result.push(item);
                continue;
            }

            // There's overlap, compare priority
            if (newConfig.level > itemConfig.level) {
                // New entitlement has HIGHER priority
                // PAUSE the old item instead of cutting it

                if (item.start < newStart) {
                    // Keep the part before newStart (already used)
                    result.push({ ...item, end: newStart });
                }

                if (!newItemInserted) {
                    result.push(newItem);
                    newItemInserted = true;
                }

                // PAUSE: Calculate UNUSED time (not total time)
                const usedTime = Math.max(0, newStart - item.start);
                const totalTime = item.end - item.start;
                const unusedTime = totalTime - usedTime;
                
                if (unusedTime > 0) {
                    result.push({ 
                        ...item, 
                        start: newEnd, 
                        end: newEnd + unusedTime 
                    });
                }
            } else {
                // Old entitlement has higher or equal priority
                // Keep old item, push new item to after
                result.push(item);

                if (!newItemInserted && item.end <= newStart) {
                    result.push(newItem);
                    newItemInserted = true;
                } else if (!newItemInserted) {
                    // Adjust new item to start after this item
                    newItem.start = item.end;
                    newItem.end = item.end + durationDays * 24 * 60 * 60 * 1000;
                }
            }
        }

        // If new item hasn't been inserted yet, add it at the end
        if (!newItemInserted) {
            result.push(newItem);
        }

        // Sort by start time and remove expired items
        return result
            .sort((a, b) => a.start - b.start)
            .filter(item => item.end > now);
    }

    /**
     * Get human-readable entitlement name
     */
    static async getEntitlementName(
        entitlementId: string,
        getEntitlementById: (id: string) => Promise<any | null>
    ): Promise<string> {
        const config = await this.getEntitlementConfig(entitlementId, getEntitlementById);
        if (!config) return entitlementId;

        const nameMap: Record<string, string> = {
            "tier_free": "Miễn phí",
            "tier_basic": "Gói Basic",
            "tier_pro": "Gói Pro"
        };

        return nameMap[entitlementId] || entitlementId;
    }
}
