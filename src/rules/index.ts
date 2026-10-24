/**
 * Rules engine: hard constraints (bounds, ceiling, door, overlap, support, stacking, fragile,
 * rotation, temperature, hazmat) and soft constraints (axle loads at every stage, gross, payload,
 * bridge formula, floor load, lateral balance, COG height, forklift, LIFO) with fix suggestions.
 */
export { checkPlan, type VehiclePhysics } from './checkPlan';
export { validateMove, type MoveCheck } from './validateMove';
