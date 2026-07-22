import './style.css';
import { Game } from './game/Game';

const canvas = document.getElementById('game');
const minimap = document.getElementById('minimap');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Missing #game canvas');
}
if (!(minimap instanceof HTMLCanvasElement)) {
  throw new Error('Missing #minimap canvas');
}

const game = new Game(canvas, minimap);
game.start();
