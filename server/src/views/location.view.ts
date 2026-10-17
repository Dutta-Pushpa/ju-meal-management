import type { PaginatedResponse } from '@ju/shared';
import type { LocationRow } from '../models/location.model.js';

/**
 * Location presenters.
 *
 * Pure functions from a model row to the public JSON shape. Timestamps are not
 * part of the contract for a location, so they are not exposed.
 */

export interface LocationView {
  id: number;
  name: string;
  nameBn: string | null;
  description: string | null;
  isActive: boolean;
}

export function presentLocation(row: LocationRow): LocationView {
  return {
    id: row.id,
    name: row.name,
    nameBn: row.name_bn,
    description: row.description,
    isActive: row.is_active,
  };
}

export function presentLocationList(rows: LocationRow[]): PaginatedResponse<LocationView> {
  const data = rows.map(presentLocation);

  return { data, meta: { total: data.length } };
}
