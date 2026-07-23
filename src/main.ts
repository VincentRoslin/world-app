import './style.css';
import { Game } from './game/Game';

const canvas = document.getElementById('game');
const minimap = document.getElementById('minimap');
const mapFull = document.getElementById('map-full');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Missing #game canvas');
}
if (!(minimap instanceof HTMLCanvasElement)) {
  throw new Error('Missing #minimap canvas');
}
if (!(mapFull instanceof HTMLCanvasElement)) {
  throw new Error('Missing #map-full canvas');
}

const game = new Game(canvas, minimap, mapFull);
game.start();
