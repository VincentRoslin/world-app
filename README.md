# Iso Base — Explore

Isometric single-player web game: build a home economy, explore a chunked world, and fight packs you find on the map.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Controls

| Input | Action |
|--------|--------|
| Left click | Select hero, worker, base, or enemy |
| Right click | Move / attack (hero) or move / gather (worker) |
| Worker → Mine / Log / Farm | Auto-paths to nearest resource node |
| WASD / arrows | Pan camera |
| Middle-drag | Pan camera |
| Scroll | Zoom |

## Economy

- Assign workers via the panel buttons; they walk to the node and work.
- Resources pay out every **10 seconds** while a worker is at their node.
- Top bar shows totals, green **+N** income, and tick countdown.

## Exploration

- You start in a **home** 16×16 chunk (fully explored).
- Moving the hero near chunk edges **generates** new tiles.
- Unexplored areas are dark; the **minimap** shows explored footprint.
- Enemy packs of 3 appear when wild chunks are generated (not on a timer).

## Stack

Vite + TypeScript + Canvas 2D.
