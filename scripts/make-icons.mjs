// Génère les icônes PWA (PNG) depuis public/favicon.svg. Usage : node scripts/make-icons.mjs
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

const svg = await readFile(new URL('../public/favicon.svg', import.meta.url));
const out = (n) => new URL(`../public/${n}`, import.meta.url).pathname;

// Icônes "any" : le carré arrondi occupe toute la toile.
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(out(name));
}
// Icône maskable : fond plein + logo réduit dans la "safe zone" (80 %).
const size = 512, inner = Math.round(size * 0.66);
const logo = await sharp(svg, { density: 384 }).resize(inner, inner).png().toBuffer();
await sharp({ create: { width: size, height: size, channels: 4, background: '#c4143a' } })
  .composite([{ input: logo, gravity: 'center' }]).png().toFile(out('icon-maskable-512.png'));
console.log('Icônes générées.');
