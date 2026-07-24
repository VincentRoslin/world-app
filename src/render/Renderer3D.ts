/**
 * 3D presentation layer (Three.js) over the existing 2D grid simulation.
 *
 * - World sim stays tile-based (x,y on ground plane → Three XZ).
 * - Orthographic-ish tactical camera (elevated, 45° yaw) for RTS/OSRS-like feel.
 * - Same public surface as the old 2D Renderer so Input/Game keep working:
 *   centerOn, clampNear, screenToWorld, worldToScreen, zoomAt, pan, render.
 */

import * as THREE from 'three';
import { CONFIG, ENEMY_SPECIES } from '../config';
import type { Entity, TileTerrain } from '../core/types';
import type { World } from '../world/World';
import { drawBar, drawHitsplat, drawHpBar } from './drawPrimitives';
import {
  HoverEase,
  affordanceFor,
  drawHoverLabel,
  labelAnchorY,
  shouldShowTileHover,
} from './highlights';

const TERRAIN_COLOR: Record<TileTerrain, number> = {
  grass: 0x347a5c,
  dirt: 0x6a533d,
  water: 0x1a4a7a,
  sand: 0xd4b87a,
  snow: 0xe8eef6,
};

const FOREST_GRASS = 0x2a6a4c;

export class Renderer {
  canvas: HTMLCanvasElement;
  /** 2D overlay for HP bars, hitsplats, labels (screen space). */
  private overlay: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private tmpV = new THREE.Vector3();

  /** Look-at on ground plane (world tile coords). */
  lookAtX = 0;
  lookAtY = 0;
  /** Higher = closer (maps to smaller ortho frustum). */
  zoom: number = CONFIG.defaultZoom;
  tickAlpha = 0;

  /**
   * Legacy pan axes used by Input: screen-pixel offsets applied via panByPixels.
   * Mutating cameraX/Y directly is not supported — use panScreen / centerOn.
   */
  cameraX = 0;
  cameraY = 0;

  private hoverEase = new HoverEase(160);
  private terrainGroup = new THREE.Group();
  private entityGroup = new THREE.Group();
  private markerGroup = new THREE.Group();
  /** Cursor hover (tile outline + entity rings) — updated every frame. */
  private hoverGroup = new THREE.Group();
  private entityMeshes = new Map<number, THREE.Object3D>();
  /** chunkKey → group of instanced terrain + décor for that chunk only */
  private chunkMeshes = new Map<string, THREE.Group>();
  private worldSeed = -1;
  private lastTerrainEpoch = -1;
  private lastMarkerKey = '';
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;

  // Shared GPU resources (never disposed per-chunk)
  private tileGeo = new THREE.BoxGeometry(0.98, 0.16, 0.98);
  private tileMats = new Map<string, THREE.MeshLambertMaterial>();
  private decoGeos = {
    trunk: new THREE.CylinderGeometry(0.08, 0.12, 0.7, 5),
    leaves: new THREE.SphereGeometry(0.45, 6, 5),
    bush: new THREE.SphereGeometry(0.28, 5, 4),
    rock: new THREE.DodecahedronGeometry(0.22, 0),
    log: new THREE.CylinderGeometry(0.08, 0.1, 0.7, 5),
  };
  private decoMats = {
    trunk: new THREE.MeshLambertMaterial({ color: 0x6e4b2a }),
    leaves: new THREE.MeshLambertMaterial({ color: 0x2ea043 }),
    bush: new THREE.MeshLambertMaterial({ color: 0x2d6a3e }),
    rock: new THREE.MeshLambertMaterial({ color: 0x6e7681 }),
    stone: new THREE.MeshLambertMaterial({ color: 0x8b949e }),
    log: new THREE.MeshLambertMaterial({ color: 0x79512e }),
  };
  private ringGeo = new THREE.RingGeometry(0.35, 0.48, 20);
  private pathDotGeo = new THREE.SphereGeometry(0.08, 6, 4);
  /** White outline loop for a single tile (LineLoop) — flat on ground. */
  private tileOutlineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.5, 0, -0.5),
    new THREE.Vector3(0.5, 0, -0.5),
    new THREE.Vector3(0.5, 0, 0.5),
    new THREE.Vector3(-0.5, 0, 0.5),
  ]);
  private scratchM = new THREE.Matrix4();
  private scratchP = new THREE.Vector3();
  private scratchQ = new THREE.Quaternion();
  private scratchS = new THREE.Vector3(1, 1, 1);
  private ndc = new THREE.Vector2();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    this.overlay = document.createElement('canvas');
    this.overlay.id = 'game-overlay';
    this.overlay.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
    canvas.parentElement?.appendChild(this.overlay);
    const octx = this.overlay.getContext('2d');
    if (!octx) throw new Error('2D overlay unavailable');
    this.octx = octx;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x152536, 1);
    // Soft shadows are expensive — lighter map is enough for tactical readability
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;

    this.scene = new THREE.Scene();
    // Soft distance fade — keep far enough that the play area stays bright
    this.scene.fog = new THREE.Fog(0x152536, 80, 160);

    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const fr = this.frustumSize();
    this.camera = new THREE.OrthographicCamera(
      (-fr * aspect) / 2,
      (fr * aspect) / 2,
      fr / 2,
      -fr / 2,
      0.1,
      500,
    );

    // Brighter lighting — Lambert materials need decent fill + sun
    this.hemi = new THREE.HemisphereLight(0xd8e8ff, 0x5a4830, 0.95);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff6e0, 1.55);
    this.sun.position.set(30, 50, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 100;
    this.sun.shadow.camera.left = -35;
    this.sun.shadow.camera.right = 35;
    this.sun.shadow.camera.top = 35;
    this.sun.shadow.camera.bottom = -35;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.scene.add(new THREE.AmbientLight(0xa8b4c8, 0.55));

    this.terrainGroup.name = 'terrain';
    this.entityGroup.name = 'entities';
    this.markerGroup.name = 'markers';
    this.hoverGroup.name = 'hover';
    this.scene.add(this.terrainGroup);
    this.scene.add(this.entityGroup);
    this.scene.add(this.markerGroup);
    this.scene.add(this.hoverGroup);

    this.resize();
  }

  private tileMat(key: string, color: number): THREE.MeshLambertMaterial {
    let m = this.tileMats.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color });
      this.tileMats.set(key, m);
    }
    return m;
  }

  private frustumSize(): number {
    // Lower zoom value → larger frustum (see more of the world)
    return 36 / Math.max(0.35, this.zoom);
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    this.overlay.width = Math.floor(w * dpr);
    this.overlay.height = Math.floor(h * dpr);
    this.overlay.style.width = `${w}px`;
    this.overlay.style.height = `${h}px`;
    this.octx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const aspect = w / Math.max(1, h);
    const fr = this.frustumSize();
    this.camera.left = (-fr * aspect) / 2;
    this.camera.right = (fr * aspect) / 2;
    this.camera.top = fr / 2;
    this.camera.bottom = -fr / 2;
    this.camera.updateProjectionMatrix();
    this.updateCameraRig();
  }

  centerOn(gx: number, gy: number): void {
    this.lookAtX = gx;
    this.lookAtY = gy;
    this.updateCameraRig();
  }

  clampNear(ax: number, ay: number, maxDist: number): void {
    const dx = this.lookAtX - ax;
    const dy = this.lookAtY - ay;
    const d = Math.hypot(dx, dy);
    if (d <= maxDist || d < 1e-6) return;
    const s = maxDist / d;
    this.centerOn(ax + dx * s, ay + dy * s);
  }

  /** Pan look-at by screen pixel delta (WASD / drag). */
  panScreen(dx: number, dy: number): void {
    const h = Math.max(1, window.innerHeight);
    const fr = this.frustumSize();
    // Pixels → world units on ground (ortho)
    const unitsPerPx = fr / h;
    // Camera yaw 45°: map screen axes onto ground XZ
    const yaw = Math.PI / 4;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    // Match 2D feel: W pans “up” the view, A pans left, drag follows the pointer
    const worldDx = (dx * cos + dy * sin) * unitsPerPx;
    const worldDz = (-dx * sin + dy * cos) * unitsPerPx;
    this.lookAtX += worldDx;
    this.lookAtY += worldDz;
    this.updateCameraRig();
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.ndc.set((sx / w) * 2 - 1, -(sy / h) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.tmpV;
    if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) {
      return { x: hit.x, y: hit.z };
    }
    return { x: this.lookAtX, y: this.lookAtY };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    this.tmpV.set(wx, 0, wy);
    this.tmpV.project(this.camera);
    const w = window.innerWidth;
    const h = window.innerHeight;
    return {
      x: ((this.tmpV.x + 1) / 2) * w,
      y: ((-this.tmpV.y + 1) / 2) * h,
    };
  }

  zoomAt(sx: number, sy: number, newZoom: number): void {
    const before = this.screenToWorld(sx, sy);
    this.zoom = Math.min(CONFIG.maxZoom, Math.max(CONFIG.minZoom, newZoom));
    // Update ortho frustum only (avoid reallocating overlay buffers every wheel tick)
    const w = window.innerWidth;
    const h = Math.max(1, window.innerHeight);
    const aspect = w / h;
    const fr = this.frustumSize();
    this.camera.left = (-fr * aspect) / 2;
    this.camera.right = (fr * aspect) / 2;
    this.camera.top = fr / 2;
    this.camera.bottom = -fr / 2;
    this.camera.updateProjectionMatrix();
    this.updateCameraRig();
    const after = this.screenToWorld(sx, sy);
    this.lookAtX += before.x - after.x;
    this.lookAtY += before.y - after.y;
    this.updateCameraRig();
  }

  private updateCameraRig(): void {
    const fr = this.frustumSize();
    // Distance of camera from look-at (along view ray)
    const dist = fr * 1.35;
    const yaw = Math.PI / 4;
    const pitch = THREE.MathUtils.degToRad(48); // elevated tactical view
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    this.camera.position.set(
      this.lookAtX + dist * cp * Math.sin(yaw),
      dist * sp,
      this.lookAtY + dist * cp * Math.cos(yaw),
    );
    this.camera.lookAt(this.lookAtX, 0, this.lookAtY);
    this.camera.updateMatrixWorld();

    // Keep sun relative to look-at for shadows
    this.sun.position.set(this.lookAtX + 25, 45, this.lookAtY + 15);
    this.sun.target.position.set(this.lookAtX, 0, this.lookAtY);
    this.sun.target.updateMatrixWorld();
    // Loose fog so mid-distance terrain stays readable/bright
    this.scene.fog = new THREE.Fog(0x152536, fr * 2.2, fr * 4.5);
  }

  render(world: World): void {
    this.rebuildTerrainIfNeeded(world);
    this.syncEntities(world);
    this.syncMarkers(world);
    this.syncHover(world);
    this.renderer.render(this.scene, this.camera);
    this.drawOverlay(world);
  }

  // ── Terrain (incremental per-chunk — critical for Dev cam streaming) ─

  private rebuildTerrainIfNeeded(world: World): void {
    // Full remesh on restart/load (epoch) or empty world
    if (
      world.terrainEpoch !== this.lastTerrainEpoch ||
      world.worldSeed !== this.worldSeed ||
      (world.loadedChunks.size === 0 && this.chunkMeshes.size > 0)
    ) {
      this.clearAllChunkMeshes();
      this.worldSeed = world.worldSeed;
      this.lastTerrainEpoch = world.terrainEpoch;
      this.lastMarkerKey = '';
      // Drop entity meshes so they recreate after load/reset
      for (const [, obj] of this.entityMeshes) {
        this.entityGroup.remove(obj);
        this.disposeObject(obj, true);
      }
      this.entityMeshes.clear();
    }

    // Mesh any newly loaded chunks only (no full-world rebuild)
    for (const key of world.loadedChunks) {
      if (!this.chunkMeshes.has(key)) {
        this.meshChunk(world, key);
      }
    }
  }

  private clearAllChunkMeshes(): void {
    for (const [, g] of this.chunkMeshes) {
      this.terrainGroup.remove(g);
      this.disposeObject(g, true);
    }
    this.chunkMeshes.clear();
  }

  private meshChunk(world: World, chunkKey: string): void {
    const [cxs, cys] = chunkKey.split(',').map(Number) as [number, number];
    const size = CONFIG.chunkSize;
    const ox = cxs * size;
    const oy = cys * size;

    const buckets = new Map<string, { x: number; z: number; y: number }[]>();
    const deco: { x: number; z: number; kind: string }[] = [];

    for (let ly = 0; ly < size; ly++) {
      for (let lx = 0; lx < size; lx++) {
        const gx = ox + lx;
        const gy = oy + ly;
        const tile = world.tileAt(gx, gy);
        if (!tile) continue;

        let colorKey = tile.terrain as string;
        if (tile.biome === 'forest' && tile.terrain === 'grass') colorKey = 'forest_grass';
        const elev = tile.terrain === 'water' ? -0.12 : 0;
        let list = buckets.get(colorKey);
        if (!list) {
          list = [];
          buckets.set(colorKey, list);
        }
        list.push({ x: gx + 0.5, z: gy + 0.5, y: elev });

        if (tile.decoration && !tile.blocked) {
          deco.push({ x: gx + 0.5, z: gy + 0.5, kind: tile.decoration });
        }
      }
    }

    const group = new THREE.Group();
    group.name = `chunk:${chunkKey}`;
    group.userData.chunkKey = chunkKey;

    for (const [key, positions] of buckets) {
      if (positions.length === 0) continue;
      const color =
        key === 'forest_grass'
          ? FOREST_GRASS
          : (TERRAIN_COLOR[key as TileTerrain] ?? 0x347a5c);
      const mesh = new THREE.InstancedMesh(
        this.tileGeo,
        this.tileMat(key, color),
        positions.length,
      );
      mesh.receiveShadow = true;
      mesh.userData.sharedGeo = true;
      mesh.userData.sharedMat = true;
      for (let i = 0; i < positions.length; i++) {
        const t = positions[i]!;
        this.scratchP.set(t.x, t.y, t.z);
        this.scratchM.compose(this.scratchP, this.scratchQ, this.scratchS);
        mesh.setMatrixAt(i, this.scratchM);
      }
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    }

    // Instanced décor (trees etc.) — far cheaper than one Group per prop
    const decoBuckets = new Map<string, { x: number; z: number }[]>();
    for (const d of deco) {
      let list = decoBuckets.get(d.kind);
      if (!list) {
        list = [];
        decoBuckets.set(d.kind, list);
      }
      list.push({ x: d.x, z: d.z });
    }
    for (const [kind, positions] of decoBuckets) {
      this.addDecoInstances(group, kind, positions);
    }

    this.terrainGroup.add(group);
    this.chunkMeshes.set(chunkKey, group);
  }

  private addDecoInstances(
    group: THREE.Group,
    kind: string,
    positions: { x: number; z: number }[],
  ): void {
    if (positions.length === 0) return;
    if (kind === 'tree') {
      this.instanceDeco(group, this.decoGeos.trunk, this.decoMats.trunk, positions, 0.35, 1, 1, 1);
      this.instanceDeco(group, this.decoGeos.leaves, this.decoMats.leaves, positions, 0.85, 1, 1, 1);
    } else if (kind === 'bush') {
      this.instanceDeco(group, this.decoGeos.bush, this.decoMats.bush, positions, 0.22, 1, 1, 1);
    } else if (kind === 'rock') {
      this.instanceDeco(group, this.decoGeos.rock, this.decoMats.rock, positions, 0.15, 1, 1, 1);
    } else if (kind === 'stone') {
      this.instanceDeco(group, this.decoGeos.rock, this.decoMats.stone, positions, 0.15, 0.85, 0.85, 0.85);
    } else if (kind === 'fallenTree') {
      // Logs lie on side
      const mesh = new THREE.InstancedMesh(this.decoGeos.log, this.decoMats.log, positions.length);
      mesh.userData.sharedGeo = true;
      mesh.userData.sharedMat = true;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
      for (let i = 0; i < positions.length; i++) {
        const t = positions[i]!;
        this.scratchP.set(t.x, 0.08, t.z);
        this.scratchM.compose(this.scratchP, q, this.scratchS);
        mesh.setMatrixAt(i, this.scratchM);
      }
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    }
  }

  private instanceDeco(
    group: THREE.Group,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    positions: { x: number; z: number }[],
    y: number,
    sx: number,
    sy: number,
    sz: number,
  ): void {
    const mesh = new THREE.InstancedMesh(geo, mat, positions.length);
    mesh.userData.sharedGeo = true;
    mesh.userData.sharedMat = true;
    mesh.castShadow = false; // décor shadows are a big cost for little gain
    this.scratchS.set(sx, sy, sz);
    for (let i = 0; i < positions.length; i++) {
      const t = positions[i]!;
      this.scratchP.set(t.x, y, t.z);
      this.scratchM.compose(this.scratchP, this.scratchQ, this.scratchS);
      mesh.setMatrixAt(i, this.scratchM);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.scratchS.set(1, 1, 1);
    group.add(mesh);
  }

  // ── Entities ───────────────────────────────────────────────────────

  private syncEntities(world: World): void {
    const live = new Set<number>();
    for (const e of world.entities.values()) {
      if (!e.alive && e.kind !== 'loot') continue;
      if (e.kind === 'loot' && e.items.length === 0) continue;
      live.add(e.id);
      let obj = this.entityMeshes.get(e.id);
      if (!obj) {
        obj = this.createEntityMesh(e);
        this.entityMeshes.set(e.id, obj);
        this.entityGroup.add(obj);
      }
      const y = e.kind === 'resourceNode' || e.kind === 'loot' ? 0 : 0;
      obj.position.set(e.x, y, e.y);
      // Face movement for hero
      if (e.kind === 'hero' && 'animFacing' in e) {
        obj.rotation.y = e.animFacing === -1 ? Math.PI / 2 : -Math.PI / 2;
      }
      // Simple walk bob for units on move
      if (
        (e.kind === 'hero' || e.kind === 'worker' || e.kind === 'enemy') &&
        e.order &&
        e.order.type === 'move' &&
        e.order.path.length > 0
      ) {
        const bob = (e.kind === 'hero' && e.animFrame != null ? e.animFrame : world.tickCount) % 2;
        obj.position.y = bob * 0.04;
      }
    }
    for (const [id, obj] of this.entityMeshes) {
      if (!live.has(id)) {
        this.entityGroup.remove(obj);
        this.disposeObject(obj, true);
        this.entityMeshes.delete(id);
      }
    }
  }

  private createEntityMesh(e: Entity): THREE.Object3D {
    const g = new THREE.Group();
    if (e.kind === 'hero') {
      g.add(this.makeHumanoid(0x3d9e5a, 0x2c2c2e, 1));
    } else if (e.kind === 'worker') {
      g.add(this.makeHumanoid(0x8b949e, 0x484f58, 0.85));
    } else if (e.kind === 'enemy') {
      const sp = ENEMY_SPECIES[e.species] ?? ENEMY_SPECIES.goblin;
      const col = new THREE.Color(sp.color);
      if (e.species === 'cow') {
        const body = new THREE.Mesh(
          new THREE.SphereGeometry(0.35, 8, 6),
          new THREE.MeshLambertMaterial({ color: col }),
        );
        body.scale.set(1.3, 0.8, 0.9);
        body.position.y = 0.35;
        body.castShadow = true;
        const head = new THREE.Mesh(
          new THREE.SphereGeometry(0.18, 6, 5),
          new THREE.MeshLambertMaterial({ color: col }),
        );
        head.position.set(0.28, 0.4, 0);
        g.add(body, head);
      } else {
        g.add(this.makeHumanoid(col.getHex(), 0x3d2b1f, e.species === 'goblin' ? 0.75 : 0.95));
      }
    } else if (e.kind === 'base') {
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(2.1, 0.15, 2.1),
        new THREE.MeshLambertMaterial({ color: 0x4a3f35 }),
      );
      pad.position.y = 0.05;
      pad.receiveShadow = true;
      const keep = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 1.4, 1.1),
        new THREE.MeshLambertMaterial({ color: 0x8b949e }),
      );
      keep.position.y = 0.8;
      keep.castShadow = true;
      const tower = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.9, 0.55),
        new THREE.MeshLambertMaterial({ color: 0x58a6ff }),
      );
      tower.position.set(0, 1.5, 0);
      tower.castShadow = true;
      g.add(pad, keep, tower);
    } else if (e.kind === 'blacksmith') {
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, e.completed ? 1.1 : 0.5, 1.6),
        new THREE.MeshLambertMaterial({ color: e.completed ? 0xa65f2e : 0x6e7681 }),
      );
      b.position.y = e.completed ? 0.55 : 0.25;
      b.castShadow = true;
      g.add(b);
    } else if (e.kind === 'npc') {
      g.add(this.makeHumanoid(0xa371f7, 0x6e40c9, 0.95));
    } else if (e.kind === 'resourceNode') {
      if (e.resource === 'stone') {
        const r = new THREE.Mesh(
          new THREE.DodecahedronGeometry(0.4, 0),
          new THREE.MeshLambertMaterial({ color: 0x8b949e }),
        );
        r.position.y = 0.35;
        r.castShadow = true;
        g.add(r);
      } else if (e.resource === 'wood') {
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.16, 0.9, 6),
          new THREE.MeshLambertMaterial({ color: 0x6e4b2a }),
        );
        trunk.position.y = 0.45;
        const leaves = new THREE.Mesh(
          new THREE.SphereGeometry(0.55, 7, 5),
          new THREE.MeshLambertMaterial({ color: 0x238636 }),
        );
        leaves.position.y = 1.05;
        leaves.castShadow = true;
        g.add(trunk, leaves);
      } else if (e.resource === 'food') {
        const field = new THREE.Mesh(
          new THREE.BoxGeometry(0.9, 0.08, 0.9),
          new THREE.MeshLambertMaterial({ color: 0xe3b341 }),
        );
        field.position.y = 0.06;
        g.add(field);
      } else if (e.resource === 'fish') {
        const w = new THREE.Mesh(
          new THREE.CircleGeometry(0.4, 8),
          new THREE.MeshLambertMaterial({ color: 0x388bfd, transparent: true, opacity: 0.7 }),
        );
        w.rotation.x = -Math.PI / 2;
        w.position.y = 0.02;
        g.add(w);
      }
    } else if (e.kind === 'loot') {
      const bag = new THREE.Mesh(
        new THREE.BoxGeometry(0.25, 0.2, 0.25),
        new THREE.MeshLambertMaterial({ color: 0xe3b341 }),
      );
      bag.position.y = 0.12;
      g.add(bag);
    }
    return g;
  }

  private humanoidGeo = {
    torso: new THREE.BoxGeometry(0.35, 0.4, 0.22),
    head: new THREE.SphereGeometry(0.14, 8, 6),
    leg: new THREE.BoxGeometry(0.12, 0.4, 0.12),
    arm: new THREE.BoxGeometry(0.1, 0.35, 0.1),
  };
  private skinMat = new THREE.MeshLambertMaterial({ color: 0xc9a07a });

  private makeHumanoid(shirt: number, pants: number, scale: number): THREE.Object3D {
    const g = new THREE.Group();
    g.scale.setScalar(scale);
    const legMat = new THREE.MeshLambertMaterial({ color: pants });
    const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });

    const torso = new THREE.Mesh(this.humanoidGeo.torso, shirtMat);
    torso.position.y = 0.75;
    torso.castShadow = true;
    torso.userData.sharedGeo = true;
    const head = new THREE.Mesh(this.humanoidGeo.head, this.skinMat);
    head.position.y = 1.08;
    head.castShadow = true;
    head.userData.sharedGeo = true;
    head.userData.sharedMat = true;
    const legL = new THREE.Mesh(this.humanoidGeo.leg, legMat);
    legL.position.set(-0.1, 0.3, 0);
    legL.userData.sharedGeo = true;
    const legR = new THREE.Mesh(this.humanoidGeo.leg, legMat);
    legR.position.set(0.1, 0.3, 0);
    legR.userData.sharedGeo = true;
    const armL = new THREE.Mesh(this.humanoidGeo.arm, this.skinMat);
    armL.position.set(-0.25, 0.72, 0);
    armL.userData.sharedGeo = true;
    armL.userData.sharedMat = true;
    const armR = new THREE.Mesh(this.humanoidGeo.arm, this.skinMat);
    armR.position.set(0.25, 0.72, 0);
    armR.userData.sharedGeo = true;
    armR.userData.sharedMat = true;
    g.add(torso, head, legL, legR, armL, armR);
    return g;
  }

  // ── Markers (selection, combat, path) ──────────────────────────────

  private syncMarkers(world: World): void {
    const hero = world.hero();
    // Skip rebuild when selection/path/combat markers unchanged
    let key = `s${world.selectedId ?? ''}:c${hero?.combatTargetId ?? ''}:q${hero?.queuedTargetId ?? ''}:p${world.pendingAttackId ?? ''}`;
    if (hero?.alive && hero.order.type === 'move') {
      key += `:m${hero.order.tx},${hero.order.ty}:n${hero.order.path.length}`;
      if (hero.order.path[0]) key += `:${hero.order.path[0].x},${hero.order.path[0].y}`;
    } else {
      key += ':m-';
    }
    if (key === this.lastMarkerKey) return;
    this.lastMarkerKey = key;

    while (this.markerGroup.children.length) {
      const c = this.markerGroup.children[0]!;
      this.markerGroup.remove(c);
      this.disposeObject(c, true);
    }

    const addRing = (x: number, z: number, color: number, scale = 1) => {
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(this.ringGeo, mat);
      ring.userData.sharedGeo = true;
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, 0.09, z);
      ring.scale.setScalar(scale);
      ring.renderOrder = 5;
      this.markerGroup.add(ring);
    };

    if (world.selectedId != null) {
      const e = world.get(world.selectedId);
      if (e && e.alive) {
        if (e.kind === 'base' || e.kind === 'blacksmith') {
          // Square outline on pad top around true 2×2 footprint
          this.addFlatFootprintOutline(
            this.markerGroup,
            e.x - 1,
            e.y - 1,
            2,
            0x58a6ff,
            0.14,
          );
        } else {
          addRing(e.x, e.y, 0x58a6ff, 1);
        }
      }
    }

    if (hero?.combatTargetId != null) {
      const t = world.get(hero.combatTargetId);
      if (t && t.alive) addRing(t.x, t.y, 0xf85149, 1.1);
    }
    if (hero?.queuedTargetId != null) {
      const t = world.get(hero.queuedTargetId);
      if (t && t.alive) addRing(t.x, t.y, 0xe3b341, 0.95);
    }
    if (world.pendingAttackId != null) {
      const t = world.get(world.pendingAttackId);
      if (t && t.alive) addRing(t.x, t.y, 0xe3b341, 1.15);
    }

    if (hero?.alive && hero.order.type === 'move') {
      addRing(hero.order.tx + 0.5, hero.order.ty + 0.5, 0xe3b341, 0.85);
      const path = hero.order.path;
      if (path.length > 0) {
        // Continuous ground line through tile centers (reads better in 3D than dots alone)
        const pts: THREE.Vector3[] = [
          new THREE.Vector3(hero.x, 0.1, hero.y),
          ...path.map((p) => new THREE.Vector3(p.x + 0.5, 0.1, p.y + 0.5)),
        ];
        const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1);
        // Slight smoothing for display only — actual walking still snaps tile-to-tile
        const lineGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(Math.min(64, pts.length * 4)));
        const line = new THREE.Line(
          lineGeo,
          new THREE.LineBasicMaterial({ color: 0xe3b341, transparent: true, opacity: 0.9 }),
        );
        this.markerGroup.add(line);

        const n = Math.min(path.length, 12);
        const mat = new THREE.MeshBasicMaterial({
          color: 0xffd666,
          transparent: true,
          opacity: 0.85,
        });
        const dots = new THREE.InstancedMesh(this.pathDotGeo, mat, n);
        dots.userData.sharedGeo = true;
        for (let i = 0; i < n; i++) {
          const p = path[i]!;
          this.scratchP.set(p.x + 0.5, 0.14, p.y + 0.5);
          this.scratchM.compose(this.scratchP, this.scratchQ, this.scratchS);
          dots.setMatrixAt(i, this.scratchM);
        }
        dots.instanceMatrix.needsUpdate = true;
        this.markerGroup.add(dots);
      }
    }
  }

  // ── Hover (tile outline + entity affordance) ───────────────────────

  private syncHover(world: World): void {
    while (this.hoverGroup.children.length) {
      const c = this.hoverGroup.children[0]!;
      this.hoverGroup.remove(c);
      this.disposeObject(c, true);
    }

    // Entity hover: accent ring + soft ground wash
    if (world.hoverEntityId != null && world.hoverEntityId !== world.selectedId) {
      const e = world.get(world.hoverEntityId);
      if (e && (e.alive || e.kind === 'loot')) {
        const aff = affordanceFor(e);
        const accent = aff ? this.cssHexToNum(aff.accent) : 0xffffff;
        if (aff?.footprint === '2x2') {
          // Base/blacksmith center is e.x,e.y → footprint min corner = e - 1
          this.addFlatFootprintOutline(this.hoverGroup, e.x - 1, e.y - 1, 2, accent, 0.14);
        } else if (aff?.footprint === 'tile') {
          this.addFlatFootprintOutline(
            this.hoverGroup,
            Math.floor(e.x),
            Math.floor(e.y),
            1,
            accent,
            0.085,
          );
        } else {
          // Units / NPCs: flat ring on the tile (no raised disc)
          const ring = new THREE.Mesh(
            this.ringGeo,
            new THREE.MeshBasicMaterial({
              color: accent,
              transparent: true,
              opacity: 0.95,
              side: THREE.DoubleSide,
              depthWrite: false,
            }),
          );
          ring.userData.sharedGeo = true;
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(e.x, 0.085, e.y);
          ring.scale.setScalar(e.kind === 'enemy' ? 1.05 : 1);
          ring.renderOrder = 2;
          this.hoverGroup.add(ring);
        }
        return; // don't also draw empty-tile hover under an entity
      }
    }

    // Empty-tile hover: slight white outline (+ soft fill)
    if (shouldShowTileHover(world) && world.hoverTile) {
      const { gx, gy } = world.hoverTile;
      if (world.tileAt(gx, gy)) {
        this.addFlatFootprintOutline(this.hoverGroup, gx, gy, 1, 0xffffff, 0.085);
      }
    }
  }

  /**
   * Flat square outline on the ground (or pad top). Not a raised volume.
   * origin = min corner in world tile units; size = 1 or 2.
   * yLift: normal tiles ~0.085 (tile top); base pad top ~0.14
   */
  private addFlatFootprintOutline(
    parent: THREE.Group,
    originGx: number,
    originGy: number,
    size: number,
    color: number,
    yLift: number,
  ): void {
    const cx = originGx + size / 2;
    const cz = originGy + size / 2;
    const s = size * 0.96;

    const outline = new THREE.LineLoop(
      this.tileOutlineGeo,
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      }),
    );
    outline.userData.sharedGeo = true;
    outline.position.set(cx, yLift, cz);
    outline.scale.set(s, 1, s);
    outline.renderOrder = 10;
    parent.add(outline);

    const inset = new THREE.LineLoop(
      this.tileOutlineGeo,
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.4,
        depthTest: false,
        depthWrite: false,
      }),
    );
    inset.userData.sharedGeo = true;
    inset.position.set(cx, yLift, cz);
    inset.scale.set(s * 0.92, 1, s * 0.92);
    inset.renderOrder = 10;
    parent.add(inset);
  }

  private cssHexToNum(hex: string): number {
    const s = hex.replace('#', '');
    if (s.length !== 6) return 0xffffff;
    return parseInt(s, 16);
  }

  /**
   * Worker bars:
   * - Gathering: resource progress timer (how long until deposit cycle)
   * - Combat / damaged: HP only (gathering would be interrupted)
   * - Walking / idle: no bar
   */
  private drawWorkerBar(
    ctx: CanvasRenderingContext2D,
    sx: number,
    barY: number,
    e: Extract<Entity, { kind: 'worker' }>,
  ): void {
    const barW = 22;
    // Damaged / in combat → HP only (gathering would be interrupted)
    if (e.hp < e.maxHp || e.order.type === 'attack') {
      drawHpBar(ctx, sx, barY, barW, e.hp, e.maxHp);
      return;
    }

    // Only while actively gathering at a node (not while walking to work/base)
    if (e.phase === 'gathering' && e.job !== 'idle') {
      const fill =
        e.job === 'mine'
          ? '#8b949e'
          : e.job === 'log'
            ? '#3fb950'
            : e.job === 'farm'
              ? '#e3b341'
              : e.job === 'build'
                ? '#58a6ff'
                : '#8b949e';
      drawBar(ctx, sx, barY, barW, e.gatherTimer, CONFIG.resourceTickInterval, fill, 3);
    }
    // Walking / idle / waiting / starving / toBase: no bar
  }

  // ── 2D overlay (HP, hitsplats, labels) ─────────────────────────────

  private drawOverlay(world: World): void {
    const ctx = this.octx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);

    for (const e of world.entities.values()) {
      if (!e.alive && e.kind !== 'loot') continue;
      if (e.kind !== 'hero' && e.kind !== 'worker' && e.kind !== 'enemy' && e.kind !== 'base') {
        continue;
      }
      const foot = this.worldToScreen(e.x, e.y);
      if (foot.x < -40 || foot.x > w + 40 || foot.y < -40 || foot.y > h + 40) continue;

      if (e.kind === 'worker') {
        this.drawWorkerBar(ctx, foot.x, foot.y - 28, e);
        continue;
      }

      const barY = foot.y - (e.kind === 'base' ? 48 : e.kind === 'hero' ? 42 : 32);
      const barW = e.kind === 'base' ? 48 : e.kind === 'hero' ? 28 : 22;
      drawHpBar(ctx, foot.x, barY, barW, e.hp, e.maxHp);
    }

    // Float texts / hitsplats
    for (const f of world.floatTexts) {
      const p = this.worldToScreen(f.x, f.y);
      const t = f.age / f.lifetime;
      const rise = t * 28;
      const alpha = Math.max(0, 1 - t);
      const sx = p.x;
      const sy = p.y - 30 - rise;
      if (f.style === 'hitsplat' || f.style === 'miss') {
        const pop = t < 0.12 ? 1 + (0.12 - t) * 1.5 : 1;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.scale(pop, pop);
        drawHitsplat(ctx, 0, 0, f.text, f.style === 'miss' ? 'miss' : 'hit', alpha);
        ctx.restore();
      } else {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = 'bold 16px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.fillStyle = f.color;
        ctx.strokeText(f.text, sx, sy);
        ctx.fillText(f.text, sx, sy);
        ctx.restore();
      }
    }

    // Hover label chip (stronger for 3D readability)
    const hoverAlpha = this.hoverEase.alpha(world.hoverEntityId);
    if (world.hoverEntityId != null && hoverAlpha > 0 && world.hoverEntityId !== world.selectedId) {
      const e = world.get(world.hoverEntityId);
      if (e && (e.alive || e.kind === 'loot')) {
        const aff = affordanceFor(e);
        if (aff) {
          const foot = this.worldToScreen(e.x, e.y);
          const labelY = labelAnchorY(e, foot.y - 10);
          drawHoverLabel(ctx, foot.x, labelY, aff.label, aff.accent, hoverAlpha);
        }
      }
    }
  }

  /**
   * Dispose mesh resources. Shared geos/mats (userData.shared*) are kept alive
   * for pooling across chunks/entities.
   */
  private disposeObject(obj: THREE.Object3D, preserveShared = false): void {
    obj.traverse((child) => {
      if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.InstancedMesh)) return;
      const sharedGeo = preserveShared || child.userData.sharedGeo;
      const sharedMat = preserveShared || child.userData.sharedMat;
      if (!sharedGeo) child.geometry?.dispose();
      const m = child.material;
      if (!sharedMat) {
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m?.dispose();
      }
    });
  }
}
