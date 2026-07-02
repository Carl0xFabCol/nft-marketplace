// ═══════════════════════════════════════════════════════════════════════════════
// REPOSITORY INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generic repository interface for database operations.
 * Concrete implementations handle specific domain entities (Listings, Bids, Activity).
 */
export interface IRepository<T> {
  /**
   * Find a single entity by ID.
   */
  findById(id: string | number): Promise<T | null>

  /**
   * Create a new entity.
   */
  create(data: Partial<T>): Promise<T>

  /**
   * Update an existing entity.
   */
  update(id: string | number, data: Partial<T>): Promise<T>

  /**
   * Upsert (insert or update) an entity.
   */
  upsert(data: Partial<T>, conflictTarget: string): Promise<T>
}
