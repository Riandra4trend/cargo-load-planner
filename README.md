# LoadPlanner 3D

Plan truck, trailer and container loads in 3D, in the browser. Define your cargo (dimensions, weight, centre of gravity, stacking, temperature, hazmat), pick a vehicle, and the app packs it, checks every axle at departure **and after every delivery stop**, and lets you drag freight around while every number updates live.

**Live app:** https://riandra4trend.github.io/cargo-load-planner/

![LoadPlanner 3D: seed plan on a US 53 ft multi-temp reefer](docs/screenshot.png)

> Planning aid only. Limits are editable defaults; verify against local regulations, vehicle documents and a weighbridge. Secure loads per EN 12195-1 / FMCSA 49 CFR 393.

## What it does

**Cargo objects**
- Item editor with live 3D preview: L × W × H in mm/cm/m/in/ft, weight in kg/t/lb, quantity, packaging presets (EUR / half / industrial / US GMA pallets, carton, crate, 200 L drum, IBC, long goods), palletized height, centre-of-gravity offset, stackable, max load on top, max layers, fragile, keep upright, allowed rotations, temperature class, food flag, hazmat (UN number, class, packing group).
- Live derived values (volume, density, footprint, loading metres) and a fit check against every vehicle and door.
- 25 built-in templates plus your own template library; CSV import (paste straight from Excel/Sheets, automatic column mapping, inch/lb conversion, per-row error report) and CSV export.

**Vehicles**
- Presets: EU van 3.5 t, EU box truck 18 t, EU 13.6 m curtainsider, US 53 ft dry van, US 53 ft multi-temp reefer, 40 ft high-cube container, US 48 ft flatbed. All values are approximate and editable.
- Custom vehicle editor (rigid or tractor + semi-trailer) with a live side-view schematic and load distribution curve.
- Several vehicles per plan; "Suggest" proposes the fewest vehicles that carry everything.

**Physics and checks**
- Axle loads for rigid vehicles and two-stage tractor/trailer statics (kingpin → steer/drive), at departure and after each stop.
- Load distribution diagram (max legal payload vs. COG position), remaining capacity with the limiting factor, sliding tandem with a "best hole" search, US Federal Bridge Formula, floor (running-metre) load, left/right balance, COG height.
- Hard rules: inside the cargo space, through the door, no overlap, ceiling and reefer airflow clearance, support ≥ 75 %, stacking limits, fragile, rotation, temperature zones, hazmat segregation (illustrative matrix) and food separation.
- Soft rules: axle/gross/payload limits at every stage, last-stop-first loading ("Batteries (stop 2) blocks stop 1"), balance, floor load. Fix suggestions apply in one click (e.g. "Slide trailer tandem 25 holes forward").

**Optimiser**
- 3D extreme-point packing plus seeded local search in a Web Worker (3 s budget, progress, cancel). It sizes the multi-temp bulkheads, picks the slider hole and respects pinned units.
- Shows a before/after diff with Accept / Revert. Unplaced units get reasons, and "Add a second vehicle" picks a vehicle that can carry the leftovers.
- Urgent orders re-plan in stable mode (keeps existing placements where possible).

**3D and simulations**
- React-three-fiber scene with tractor/trailer models, wheels at the real axle positions, temperature zones, bulkheads, bays, COG marker, axle labels and violation callouts.
- Cargo is drawn as realistic goods, all generated from primitives to fit each item's exact dimensions:
  - wooden pallets with taped, labelled cartons under stretch film
  - frost-wrapped frozen goods, dairy and produce crates, beverage packs
  - paint pails, battery packs, boxed TVs
  - plank crates and glass crates, machines on skids, strapped steel bundles
  - drums, paper rolls, cable reels, IBC totes

  Stop colours show on corner boards and labels. A Blocks mode switches to plain coloured boxes for analysis.
- Drag to move or stack (R rotates, Esc cancels); illegal drops show a red ghost with the reasons. Side and top views are orthographic; the Plan view is a printable dimensioned floor plan + side elevation.
- Colour by stop, customer, temperature, hazmat or weight.
- "Load at dock": an animated forklift loads the plan from colour-coded staging lanes, with a numbered step list. The unload simulation steps through the stops.

**Files and sharing**
- Autosave, named plans, JSON export/import (exact round trip), share links (plan compressed into the URL), print/PDF report, PNG snapshot, undo/redo, metric/imperial toggle everywhere.

## Run it locally

Requires Node 20+ (developed on Node 24).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # physics, rules, optimiser, IO, scene and item tests
npm run build      # static site in dist/
npm run preview    # serve the production build
```

Keyboard: `R` rotate · `Delete` remove from vehicle · `Ctrl+Z` / `Ctrl+Y` undo/redo · `F` focus selection · `1`–`4` views · `Space` play/pause simulation · `Esc` cancel/clear.

## How the physics works

Every axle group's load is affine in the cargo: `load_i = tare_i + Σ kg_j · share_i(x_j)`.

- **Rigid vehicle:** the front and rear axle groups are the supports. A load *W* at distance *a* behind the front axle, with wheelbase *L*, puts *W·a/L* on the rear group and *W − W·a/L* on the front. This also holds behind the rear axle, where the front axle is unloaded.
- **Tractor + semi-trailer:** trailer loads resolve onto the kingpin and the trailer axle group (moments about the kingpin). The kingpin load then resolves onto the steer and drive groups from the fifth-wheel position.
- **Load distribution curve:** for every COG position it takes the minimum over the payload, the gross limit, each axle maximum and each axle minimum share.

The tests pin these with hand-computed cases. For example, 1000 kg at x = 5 m on a trailer with the kingpin at 1 m and the tandem at 11 m gives 600 kg on the kingpin and 400 kg on the tandem, which becomes 47.37 kg steer / 552.63 kg drive.

## Project structure

```
src/
  domain/    types (shared contract), units, geometry, presets, settings, colours
  physics/   axle statics, stages, load distribution, capacity, Bridge Formula, slider
  rules/     hard/soft checks, LIFO, support/stacking, hazmat, fix suggestions, validateMove
  packing/   construction + local search optimiser, Web Worker, findPlacementFor, proposeVehicles
  state/     Zustand store (undo/redo), plan evaluation, hooks
  scene/     react-three-fiber viewport, vehicle/cargo models, drag, camera, simulations
  ui/        shell (top bar, panels, KPIs, plan view, dialogs), data (item table/editor), io dialogs
  io/        JSON, CSV, share links, persistence, bootstrap
  data/      seed scenario, item templates, packaging presets, empty plan
  sim/       loading sequence
```

## Assumptions and limitations

- Vehicle presets, tare axle loads and limits are typical illustrative values, not manufacturer data. Edit them to match your registration papers.
- The hazmat compatibility matrix is illustrative, loosely based on ADR 7.5.2 / 49 CFR 177.848. It is not a legal reference.
- Cylinders are packed by their bounding boxes. The optimiser is heuristic: good, not provably optimal. With a fixed seed it is deterministic for a given iteration count, but the iteration count depends on machine speed.
- Not certified for legal compliance. Load securing (lashing) is out of scope.
